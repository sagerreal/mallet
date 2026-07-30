"use client";

/**
 * features/quotes/estimates-hydrator.tsx
 * Mounts in the office layout. Subscribes to trpc.v1.quoting.list and writes
 * the result into the Zustand store so every existing consumer (pipeline rail,
 * OK queue, money derive, etc.) sees real DB data without changes.
 *
 * The list endpoint returns estimateSummaryDTO — id/num/leadId/title/status/
 * total{cents}/createdAt. Lines and bps are only on the full estimateDTO
 * (fetched per-modal via quoting.get). The store Estimate.lines defaults to
 * [] and Estimate.pricing defaults to undefined until a modal fetches the full
 * record; this matches the existing prototype pattern where list views never
 * render individual lines.
 *
 * Status alignment: backend ESTIMATE_STATUSES = draft|sent|accepted|declined.
 * Store (derive.ts) filters on "draft", "sent", "accepted" directly — values
 * already align, no remapping needed.
 *
 * Rate/pricing units: the list DTO carries total{cents} but no bps. The store
 * Estimate.pricing (disc/dep/tax) is only used in the estimate-modal which
 * fetches the full DTO. EstimateLine.r is cents-per-unit (matches the modal's
 * display). Lines are empty from list; the modal loads them on open.
 *
 * read telemetry (reads[]) is client-local — it is not persisted. Hydrator
 * initialises reads=[] on every load; live read sessions are lost on refresh.
 * This is the same behaviour as the prototype.
 */

import { api, type RouterOutputs } from "@/lib/trpc/client";
import { useAppStore } from "@/lib/store/app-store";
import type { Estimate } from "@/lib/store/types";
import { useStoreHydrator } from "@/lib/store/use-store-hydrator";
import { HYDRATOR_STALE_MS, HYDRATOR_PAGE_LIMIT } from "@/lib/store/hydrator-config";

type EstimateSummaryDTO = RouterOutputs["v1"]["quoting"]["list"]["items"][number];

function daysAgo(isoDate: string): number {
  return Math.floor((Date.now() - new Date(isoDate).getTime()) / 86_400_000);
}

/**
 * List-summary DTO → store estimate. Exported for tests: this is the mapping the store takes after
 * a REFRESH, and a field dropped here is invisible until someone reloads the page and a feature
 * quietly stops working (that is exactly how publicUrl broke the send path once).
 */
export function toStoreEstimate(dto: EstimateSummaryDTO): Estimate {
  return {
    id: dto.id,
    num: dto.num,
    leadId: dto.leadId,
    title: dto.title ?? "Quote",
    // Status values align 1:1: draft|sent|accepted|declined match what
    // derive.ts filters on (shop=draft, out=sent, won=accepted).
    status: dto.status,
    age: daysAgo(dto.createdAt),
    // viewed: true if the estimate was ever sent (acceptedAt/sentAt implies a
    // customer received it), false for drafts. The list DTO carries no sentAt,
    // so we derive: anything past "draft" was at minimum sent.
    viewed: dto.status !== "draft",
    // validDays: not in summary DTO; loaded by the modal via quoting.get.
    validDays: undefined,
    // fu: follow-up is fully client-local, not persisted.
    fu: { on: false, stage: 0 },
    // lines: empty from list DTO; modal fetches them via quoting.get on open.
    lines: [],
    // pricing: bps not in summary DTO; modal fetches them.
    pricing: undefined,
    // reads: client-authored read telemetry — not persisted; reset on load.
    reads: [],
    // cachedTotal: list-DTO total converted to dollars; estTotal() falls back to
    // calcQuote(lines) once the modal loads the full record.
    cachedTotal: dto.total.cents / 100,
    // publicToken: the /q/<token> share link — carried on summaries so the
    // estimate modal can send the quote by text/email after a refresh.
    publicToken: dto.publicToken ?? undefined,
    // publicUrl: the FINISHED customer link, composed server-side. Must ride the summary too — this
    // hydrator is the path the store takes after a refresh, and the send path refuses without it.
    publicUrl: dto.publicUrl ?? undefined,
    // changeRequestedAt from the summary DTO — indicates a pending customer request.
    changeRequestedAt: dto.changeRequestedAt ?? undefined,
    // Good/Better/Best fields — on summaries so the modal/rails can show the
    // tier line ("3 options · recommended Better" / "Accepted: Best") from
    // list-hydrated data. The summary total already derives from the right tier.
    recommendedTier: dto.recommendedTier ?? undefined,
    acceptedTier: dto.acceptedTier ?? undefined,
    tierNames: dto.tierNames ?? undefined,
    termsSnapshot: dto.termsSnapshot ?? undefined,
    // signed: the fact, not the evidence. The quote rows must not print "Signed" over an office
    // phone approval, and they render from this list long before the full record is fetched.
    signed: dto.signed,
    archived: false,
    trash: false,
  };
}

export function EstimatesHydrator() {
  const setEstimates = useAppStore((s) => s.setEstimates);
  // refetchOnWindowFocus: false — prevents the hydrator from clobbering
  // optimistic writes that the slice applied while the window was in the background.
  const { data, isError, error } = api.v1.quoting.list.useQuery(
    { limit: HYDRATOR_PAGE_LIMIT },
    { staleTime: HYDRATOR_STALE_MS, refetchOnWindowFocus: false },
  );

  useStoreHydrator({
    data,
    isError,
    error,
    transform: toStoreEstimate,
    setSlice: setEstimates,
    label: "estimates",
  });

  return null;
}
