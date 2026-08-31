"use client";

/**
 * Composer page — "New quote".
 * Wired to the Zustand app-store (leads + estimates). One layout, read
 * top-to-bottom: Customer → The quote → Pricing → Message → Send. The quote
 * card carries the format toggle (single quote ↔ Good/Better/Best); the page
 * orchestrates, the sections live in sibling components:
 *   composer-state.ts   — ComposerState + pure helpers (single source of truth)
 *   customer-selector   — pick / quick-add the customer
 *   quote-card          — format toggle, authoring tools, AI panel, totals
 *   line-table          — the shared line-editor grid (single + tier panels)
 *   gbb-tiers           — the Good/Better/Best tier panels
 *   gbb-suggest         — "Suggest Better & Best from Good" heuristics (not AI)
 *   pricing-card        — discount / deposit / tax
 *   message-card        — intro (leads the send body) + valid days
 *   send-card           — channel, destination, follow-ups, action row
 *
 * A GBB quote saves / previews / sends the FULL three-tier structure (every
 * real line tagged with its tier + recommendedTier + tierNames) — customers
 * pick one of the three options on their quote page. linesForSend() (the
 * recommended tier at call time) drives gating + the totals display only.
 *
 * The quote card reads the real pricebook (s.services) for "From pricebook"
 *
 * Deferred (intentional no-op — see inline comment in quote-card.tsx):
 *   - descMic() / 🎤     — no speech API in the app yet
 */

import { useState, useEffect, useRef, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLeads, useAppStore } from "@/lib/store/app-store";
import type { Lead } from "@/lib/store/types";
import { STAGE_ORDER } from "@/features/pipeline/pipeline-constants";
import { api } from "@/lib/trpc/client";
import { fmt$ } from "@/lib/format";
import {
  INITIAL_STATE,
  addHeldTrace,
  aiDraftForPayload,
  applyAiDraftLines,
  applyAiDraftTiers,
  appendMeasurementLines,
  applyComposerPatch,
  applyMeasurementSeed,
  buildQuoteMessageBody,
  deliveryGateReason,
  gapNoticeText,
  hasRealLine,
  laborRulePayload,
  linesForSend,
  applyReviseSeed,
  lineToPayload,
  presentationSnapshotForPayload,
  matchServiceByName,
  realLines,
  realJobCosts,
  recommendedTier,
  seedLinesToComposerLines,
  sendGateReason,
  tierDisplayName,
  tieredLinesForPayload,
  tierNamesForPayload,
  toProposalChips,
  unconfirmedRoomsNoticeText,
  type AiTiersDraft,
  type ComposerLine,
  type ComposerState,
  type MeasurementGap,
  type ProposalChip,
  type TierKey,
} from "./composer-state";
import { sectionsForPayload, type SavedComponent } from "./line-math";
import { useSmsGate } from "@/features/a2p/use-sms-ready";
import { suggestFromGood } from "./gbb-suggest";
import { MeasuredSurfacesPanel } from "./measured-surfaces-panel";
import { CustomerSelector } from "./customer-selector";
import { PresentationTab } from "./presentation-tab";
import { SiteReference } from "./site-reference";
import { QuoteCard } from "./quote-card";
import { PricingCard } from "./pricing-card";
import { MessageCard } from "./message-card";
import { SendCard } from "./send-card";

export default function ComposerPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const leads = useLeads();
  const adoptEstimate = useAppStore((s) => s.adoptEstimate);
  const moveLeadStage = useAppStore((s) => s.moveLeadStage);
  const addLeadNote = useAppStore((s) => s.addLeadNote);
  // The real pricebook catalog — "From pricebook" reads it; "Save to book" writes to it.
  const services = useAppStore((s) => s.services);
  /**
   * Every saved assembly's parts, keyed by pricebook entry — what the editor compares a
   * quote's assembly against to decide whether it is unsaved, in the book, or drifted.
   * Derived here so the comparison has one source and the table never reaches into the store.
   */
  const saveAssemblyToBook = useAppStore((s) => s.saveAssembly);

  /**
   * Save the assembly at `parentIndex` into the book. The server mints the ids, so the line
   * re-points at whatever came back — without that, a "Save as new" would leave the quote
   * pointing at the entry it was copied FROM and the next Update would overwrite the wrong one.
   */
  async function saveAssembly(parentIndex: number, itemId: string | null) {
    const parent = cs.lines[parentIndex];
    if (!parent) return;
    const components = cs.lines.filter((l) => l.parentIndex === parentIndex);
    if (components.length === 0) return;
    const result = await saveAssemblyToBook({
      itemId,
      name: parent.d.trim() || "Untitled assembly",
      unit: parent.unit ?? null,
      unitPrice: parent.r ?? 0,
      // The run the rate is true for. Saved WITH the rate because an assembly's parts are
      // counted by expressions whose "+1" terms do not scale — see defaultQuantity's own note.
      quantity: parent.q > 0 ? parent.q : 1,
      cost: parent.c ?? 0,
      taxable: !parent.notax,
      components: components.map((c) => ({
        d: c.d.trim() || "Part",
        unit: c.unit ?? null,
        qtyExpr: c.qtyExpr ?? null,
        roundUp: c.roundUp ?? false,
        cost: c.c ?? 0,
        rate: c.r ?? 0,
        markupBps: c.markupBps ?? null,
      })),
    });
    if (!result.ok || !result.service) return;
    const savedId = result.service.id;
    setCs((prev) => ({
      ...prev,
      lines: prev.lines.map((l, i) => (i === parentIndex ? { ...l, pricebookItemId: savedId } : l)),
    }));
  }

  const savedAssemblies = useMemo(() => {
    const byItem = new Map<string, SavedComponent[]>();
    for (const service of services) {
      if (!service.components || service.components.length === 0) continue;
      byItem.set(
        service.id,
        service.components.map((c) => ({
          d: c.d,
          unit: c.unit,
          qtyExpr: c.qtyExpr,
          roundUp: c.roundUp,
          cost: c.cost,
          rate: c.rate,
          markupBps: c.markupBps,
        })),
      );
    }
    return byItem;
  }, [services]);
  const materials = useAppStore((s) => s.materials);
  const laborRates = useAppStore((s) => s.laborRates);
  // One-tap "Update labor to Nh" chips write back through the store's service update.
  const updateService = useAppStore((s) => s.updateService);

  // Seed leadId from ?lead= once (read-only initializer so state edits persist).
  // ?desc= rides alongside it: the new-customer modal's Build-the-price hands
  // off the typed job description so the office doesn't retype it here — it
  // seeds the describe-the-job bar (QuoteCard reads state.desc at mount).
  const [cs, setCs] = useState<ComposerState>(() => {
    const raw = searchParams.get("lead");
    const leadId = raw != null && raw !== "" ? raw : null;
    const desc = searchParams.get("desc")?.trim() ?? "";
    // ?job= is the scope-visit job this quote prices (scoped card / Build-the-price). Held in
    // composer state and sent as the draft's jobId, so accepting the quote converts THAT job
    // into the sold work instead of minting a duplicate next to the walkthrough.
    const jobParam = searchParams.get("job");
    return {
      ...INITIAL_STATE,
      leadId,
      desc,
      jobId: jobParam != null && jobParam !== "" ? jobParam : null,
    };
  });

  const [aiDraftError, setAiDraftError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [custError, setCustError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  // Save draft awaits the server before it navigates, so it has an in-flight window of its own —
  // separate from isSending, which owns the Send button's copy.
  const [isSavingDraft, setIsSavingDraft] = useState(false);

  // Invalidates the cached customer list so the leads hydrator picks up a
  // freshly-created customer (with its server-assigned id) into the store.
  // Estimate | Presentation full-page tabs (?tab= deep-link, popstate-aware like /dashboard).
  const [tab, setTab] = useState<"estimate" | "presentation">("estimate");
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t === "presentation") setTab("presentation");
    const onPop = () => {
      const q = new URLSearchParams(window.location.search).get("tab");
      setTab(q === "presentation" ? "presentation" : "estimate");
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  function switchTab(t: "estimate" | "presentation") {
    setTab(t);
    const url = new URL(window.location.href);
    if (t === "presentation") url.searchParams.set("tab", "presentation");
    else url.searchParams.delete("tab");
    window.history.pushState(null, "", url.pathname + url.search);
  }

  const utils = api.useUtils();

  // ---- ?job= boot: "Build the price" from a measured job --------------------
  // A measured job's Build-the-price button lands here with ?job=<jobId>. The
  // read-only query turns rooms × pricebook rates into seed lines; applied to
  // ComposerState ONCE (a background refetch must never re-stomp office edits,
  // same "seed once" contract as the ?lead= initializer above).
  const jobId = searchParams.get("job");
  // A quote raised AGAINST a running job — ?change=<jobId>. Distinct from ?job=, which seeds a
  // price FROM a job's measurements; this one says the quote BELONGS to that job.
  //
  // NOT the path "+ More work" takes. Extra work found on site is priced and signed in place
  // (TECH_QUOTE on the job) — sending someone to a blank full quote builder to add one line was
  // the wrong shape for that. This remains for the REMOTE case: the customer is not there, so the
  // add-on has to be composed, sent, and signed at a distance like any other quote.
  const changeOrderJobId = searchParams.get("change");
  const buildFromMeasurementsQuery = api.v1.quoting.buildFromMeasurements.useQuery(
    { jobId: jobId ?? "" },
    { enabled: Boolean(jobId), retry: false, refetchOnWindowFocus: false },
  );
  const [measurementNotice, setMeasurementNotice] = useState<{
    gaps: MeasurementGap[];
    unconfirmedRooms: string[];
  } | null>(null);
  // Keyed on the jobId itself (not a plain mounted-once flag) — a same-route param change
  // (?job=A -> ?job=B on an already-mounted composer) must still seed B; StrictMode's
  // double-invoke and a background refetch for the SAME jobId still no-op (ref.current
  // already equals jobId).
  const seededForJob = useRef<string | null>(null);
  useEffect(() => {
    if (!jobId || seededForJob.current === jobId || !buildFromMeasurementsQuery.data) return;
    seededForJob.current = jobId;
    const built = buildFromMeasurementsQuery.data;
    // ?job= wins over ?lead= when both are present: the leadId here overwrites whatever
    // ?lead= seeded into the initial state. Currently unreachable in practice (the
    // Build-the-price button only ever sets ?job=), but intentional if that ever changes.
    // jobId re-stamps alongside the seed so a same-route ?job=A → ?job=B change carries the
    // NEW job onto the draft, not the one the composer mounted with.
    setCs((prev) => ({
      ...applyMeasurementSeed(prev, built.leadId, seedLinesToComposerLines(built.seedLines)),
      jobId,
    }));
    setMeasurementNotice({ gaps: built.gaps, unconfirmedRooms: built.unconfirmedRooms });
  }, [jobId, buildFromMeasurementsQuery.data]);

  // ---- ?revise= boot: edit-and-resend an already-sent quote -----------------
  // "Revise" on a sent quote (change-requested or not) lands here with
  // ?revise=<estimateId>. The full record (list hydration only carries headers)
  // seeds lead/title/pricing/lines — tiered quotes restore their tiers. The
  // ORIGINAL stays live until the revision sends; then it's archived (below), so
  // abandoning the composer changes nothing.
  // ---- the shop's default sales-tax rate ------------------------------------
  // One rate per document, defaulted from Settings — the model both incumbents use, and the
  // consumer the org-level rate was built for. Seeded ONCE onto a fresh quote and never onto a
  // revision (a revision restores the rate the quote was sent with) or over a rate the office has
  // already set by hand. A shop with no rate on file gets 0 and nothing changes.
  const orgSettingsQuery = api.v1.settings.get.useQuery(undefined, { refetchOnWindowFocus: false });
  const seededOrgTax = useRef(false);
  const orgTaxBps = orgSettingsQuery.data?.config.taxBps ?? 0;
  const revising = searchParams.get("revise") != null;
  useEffect(() => {
    if (seededOrgTax.current || revising || !orgSettingsQuery.data || orgTaxBps <= 0) return;
    seededOrgTax.current = true;
    setCs((prev) =>
      prev.pricing.tax > 0 ? prev : { ...prev, pricing: { ...prev.pricing, tax: orgTaxBps / 100 } },
    );
  }, [orgSettingsQuery.data, orgTaxBps, revising]);

  const reviseId = searchParams.get("revise");
  const reviseQuery = api.v1.quoting.get.useQuery(
    { estimateId: reviseId ?? "" },
    { enabled: Boolean(reviseId), retry: false, refetchOnWindowFocus: false },
  );
  const seededForRevise = useRef<string | null>(null);
  useEffect(() => {
    if (!reviseId || seededForRevise.current === reviseId || !reviseQuery.data) return;
    seededForRevise.current = reviseId;
    const dto = reviseQuery.data;
    setCs((prev) =>
      applyReviseSeed(prev, {
        leadId: dto.leadId,
        title: dto.title ?? "",
        discBps: dto.discBps,
        taxBps: dto.taxBps,
        depBps: dto.depBps,
        recommendedTier: dto.recommendedTier ?? null,
        tierNames: dto.tierNames ?? null,
        // The walkthrough link survives a revision — without it, "Edit & resend" would send a
        // quote whose accept mints a duplicate job. Server-side validation re-guards it on the
        // revision's own draft (assertScopeVisitJob runs on every v1.quoting.draft).
        jobId: dto.jobId ?? null,
        priceDisplay: dto.priceDisplay,
        // The DTO writes an absent photo field as null; the composer writes it as absent.
        // Normalized here, at the one boundary that sees both.
        presentationSnapshot: dto.presentationSnapshot
          ? {
              ...dto.presentationSnapshot,
              pages: dto.presentationSnapshot.pages.map((page) => ({
                key: page.key,
                title: page.title,
                body: page.body,
                ...(page.photos && page.photos.length > 0
                  ? {
                      photos: page.photos.map((photo) => ({
                        id: photo.id,
                        key: photo.key,
                        ...(photo.beforeKey ? { beforeKey: photo.beforeKey } : {}),
                        ...(photo.caption ? { caption: photo.caption } : {}),
                      })),
                    }
                  : {}),
              })),
            }
          : null,
        lines: dto.lines.map((l) => ({
          d: l.description,
          q: l.quantity,
          rCents: l.rate.cents,
          cCents: l.cost.cents,
          opt: l.isOptional,
          photo: l.needsPhoto,
          taxable: l.taxable,
          tier: l.tier ?? null,
          scope: l.scope ?? null,
          subItems: l.subItems ?? null,
          id: l.id,
          unit: l.unit ?? null,
          qtyExpr: l.qtyExpr ?? null,
          roundUp: l.roundUp,
          parentLineId: l.parentLineId ?? null,
          customerVisible: l.customerVisible,
          markupBps: l.markupBps ?? null,
          sectionId: l.sectionId ?? null,
        })),
        sections: dto.sections.map((section) => ({ id: section.id, name: section.name })),
        jobCosts: dto.jobCosts.map((cost) => ({
          id: cost.id,
          description: cost.description,
          amountCents: cost.amount.cents,
          purchaseOrderId: cost.purchaseOrderId,
        })),
      }),
    );
  }, [reviseId, reviseQuery.data]);

  // ---- tRPC mutations for the real send flow --------------------------------

  // Step 1: persist the estimate draft (returns publicToken among other fields).
  const quoteDraftMutation = api.v1.quoting.draft.useMutation();
  // Step 2: mark the estimate as sent (stamps sentAt).
  const quoteSendMutation = api.v1.quoting.send.useMutation();
  // Preview drafts persisted this composer session: reused per distinct state (no
  // duplicate drafts on re-click) and archived once the real send supersedes them.
  const previewDraftsRef = useRef<{ key: string; id: string; token: string | null }[]>([]);
  const quoteArchiveMutation = api.v1.quoting.archive.useMutation();
  // Step 3a: send SMS via Twilio (gated on A2P provisioning).
  // May this shop text at all? Asked before the destination gate — see the SendCard below.
  const smsGate = useSmsGate();
  const messagingSendMutation = api.v1.messaging.send.useMutation();
  // Step 3b: send the quote link by email via the notifications sender (Resend,
  // gated server-side on RESEND_API_KEY + EMAIL_FROM).
  const notificationsSendMutation = api.v1.notifications.send.useMutation();
  // Inline "+ Add new customer" — persists a real DB lead so quotes can reference it.
  const createCustomerMutation = api.v1.customers.create.useMutation();

  // Shared error copy for both AI drafters (single + tiered) — same failure modes.
  function onAiDraftError(err: { data?: { code?: string } | null }) {
    setRun(null);
    setRunResult(null);
    const code = err.data?.code;
    if (code === "PRECONDITION_FAILED") {
      setAiDraftError("AI isn't enabled yet — ask your admin to add the API key.");
    } else if (code === "TOO_MANY_REQUESTS") {
      setAiDraftError("AI is busy right now — try again in a moment.");
    } else {
      setAiDraftError("Couldn't draft with AI — try rephrasing, or add lines manually.");
    }
  }

  // rateCents → dollars (ComposerLine.r is in dollars, e.g. r:170 = $170)
  function toComposerLines(lines: { description: string; quantity: number; rateCents: number }[]): ComposerLine[] {
    return lines.map((l) => ({ d: l.description, q: l.quantity, r: l.rateCents / 100 }));
  }

  // The drafters gather lead context server-side when given a real (persisted)
  // lead id. Store-local drafts can carry non-uuid ids — send nothing for those.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function uuidOrUndefined(id: string | null): string | undefined {
    return id && UUID_RE.test(id) ? id : undefined;
  }

  // The staged run reveal: set when a draft starts; carries the lead id so the
  // gather query (fired at t=0, concurrent with the model call) shows real
  // job-info counts while the model works. Lines apply to state the moment the
  // mutation resolves — the reveal is purely presentational on top.
  const [run, setRun] = useState<{ leadId: string | undefined } | null>(null);
  const [runResult, setRunResult] = useState<{
    wonQuotes: { count: number; nums: string[] };
    rules: { count: number } | null;
    summary: { lineCount: number; total: string } | null;
  } | null>(null);

  // The final stage's landed number ("3 lines · $2,475") — sum in dollars from
  // the drafted rateCents, matching what the table will show.
  function draftSummary(lines: { quantity: number; rateCents: number }[]) {
    const total = lines.reduce((s, l) => s + l.quantity * (l.rateCents / 100), 0);
    return { lineCount: lines.length, total: fmt$(total) };
  }
  const [materialize, setMaterialize] = useState(false);
  const gatherQuery = api.v1.ai.gatherJobContext.useQuery(
    { leadId: run?.leadId ?? "" },
    { enabled: Boolean(run?.leadId), staleTime: 30_000, retry: false, refetchOnWindowFocus: false },
  );

  function finishRun() {
    setRun(null);
    setRunResult(null);
    setMaterialize(true);
    setTimeout(() => setMaterialize(false), 1_600);
  }

  // Durable-fact proposals extracted from a refine correction — rendered as
  // one-tap chips under the quote ("Update 'X' labor to 5h in your pricebook?").
  // Keyed by a stable id assigned when they land: accept/dismiss act on the id
  // (an array index captured at tap time races a concurrent dismissal and
  // removes the WRONG chip → a re-tap mints a duplicate confirmed rule).
  const [proposals, setProposals] = useState<ProposalChip[]>([]);
  const [proposalError, setProposalError] = useState<string | null>(null);
  const createRuleMutation = api.v1.quoting.rules.create.useMutation();

  // Single-format drafter: one set of lines into the table (or the Good tier
  // when a mid-flight format switch landed the response in GBB).
  const draftEstimateMutation = api.v1.ai.draftEstimate.useMutation({
    onSuccess: (data) => {
      setCs((prev) => applyAiDraftLines(prev, toComposerLines(data.lines)));
      setAiDraftError(null);
      setProposals(toProposalChips(data.proposals, () => crypto.randomUUID()));
      setRunResult({
        wonQuotes: data.stages.wonQuotes,
        rules: data.stages.rules ?? null,
        summary: draftSummary(data.lines),
      });
    },
    onError: onAiDraftError,
  });

  // GBB drafter: fills ALL THREE tier panels + stars the AI's recommended key.
  const draftTiersMutation = api.v1.ai.draftEstimateTiers.useMutation({
    onSuccess: (data) => {
      const draft: AiTiersDraft = {
        recommended: data.recommended,
        good: { note: data.good.note, lines: toComposerLines(data.good.lines) },
        better: { note: data.better.note, lines: toComposerLines(data.better.lines) },
        best: { note: data.best.note, lines: toComposerLines(data.best.lines) },
      };
      setCs((prev) => applyAiDraftTiers(prev, draft));
      setAiDraftError(null);
      setProposals(toProposalChips(data.proposals, () => crypto.randomUUID()));
      setRunResult({
        wonQuotes: data.stages.wonQuotes,
        rules: data.stages.rules ?? null,
        // GBB: the recommended tier is what the stepper's number should land on.
        summary: draftSummary(data[data.recommended].lines),
      });
    },
    onError: onAiDraftError,
  });

  function update(patch: Partial<ComposerState>) {
    // applyComposerPatch clears a stale format-switch note on line/tier edits.
    setCs((prev) => applyComposerPatch(prev, patch));
  }

  function triggerAiDraft() {
    if (!cs.desc.trim()) return;
    setAiDraftError(null);
    setProposals([]);
    setProposalError(null);
    const leadId = uuidOrUndefined(cs.leadId);
    setRun({ leadId });
    setRunResult(null);
    // GBB format drafts all three options; single format keeps the one-shot lines.
    if (cs.format === "gbb" && cs.gbb) {
      draftTiersMutation.mutate({ description: cs.desc, leadId });
    } else {
      draftEstimateMutation.mutate({ description: cs.desc, leadId });
    }
  }

  // Refine: re-run the drafter with the lines currently on screen + the
  // office's correction. The model regenerates and may return durable-fact
  // proposals (labor hours / rules) — never written without a tap.
  function triggerRefine(feedback: string) {
    const text = feedback.trim();
    if (!text) return;
    const shown = cs.format === "gbb" && cs.gbb ? tieredLinesForPayload(cs.gbb) : realLines(cs.lines);
    const previousLines = shown.slice(0, 30).map((l) => ({
      description: l.d,
      quantity: l.q ?? 1,
      rateCents: Math.round((l.r ?? 0) * 100),
    }));
    if (previousLines.length === 0) return;
    setAiDraftError(null);
    setProposals([]);
    setProposalError(null);
    const leadId = uuidOrUndefined(cs.leadId);
    setRun({ leadId });
    setRunResult(null);
    const description = cs.desc.trim() || previousLines.map((l) => l.description).join(", ").slice(0, 2000);
    const refine = { feedback: text.slice(0, 1000), previousLines };
    if (cs.format === "gbb" && cs.gbb) {
      draftTiersMutation.mutate({ description, leadId, refine });
    } else {
      draftEstimateMutation.mutate({ description, leadId, refine });
    }
  }

  function dismissProposal(id: string) {
    setProposals((prev) => prev.filter((p) => p.id !== id));
  }

  // Flip one chip's in-flight flag (disables both of its buttons while true).
  function setProposalSaving(id: string, saving: boolean) {
    setProposals((prev) => prev.map((p) => (p.id === id ? { ...p, saving } : p)));
  }

  // Accept a proposal: labor_hours writes back to the matching pricebook
  // service (store action syncs the server); rules persist via
  // v1.quoting.rules.create (source 'refine' — confirmed for owner/office
  // unless it contradicts an existing rule, which lands it in review).
  // Every path AWAITS its write and dismisses the chip only on success — a
  // silent rollback here would leave the user believing the pricebook updated
  // while future AI drafts keep repeating the error they just corrected.
  async function acceptProposal(id: string) {
    const p = proposals.find((x) => x.id === id);
    if (!p || p.saving) return;
    setProposalError(null);
    setProposalSaving(id, true);
    const onRuleError = () => {
      setProposalSaving(id, false);
      setProposalError("Couldn't save the rule — check your connection and try again.");
    };
    if (p.kind === "labor_hours") {
      const svc = matchServiceByName(services, p.serviceName);
      if (svc) {
        const result = await updateService(svc.id, { laborHours: p.hours });
        if (result.ok) {
          dismissProposal(id);
        } else {
          setProposalSaving(id, false);
          setProposalError("Couldn't update the pricebook — try again.");
        }
        return;
      }
      // No pricebook match — keep the fact as a shop rule instead of dropping it.
      createRuleMutation.mutate(
        { ...laborRulePayload(p), source: "refine" },
        { onSuccess: () => dismissProposal(id), onError: onRuleError },
      );
      return;
    }
    createRuleMutation.mutate(
      { rule: p.rule, source: "refine" },
      { onSuccess: () => dismissProposal(id), onError: onRuleError },
    );
  }

  const selectedLead: Lead | null =
    cs.leadId != null ? (leads.find((l) => l.id === cs.leadId) ?? null) : null;

  // "Suggest Better & Best from Good" — pure heuristics (gbb-suggest.ts), NOT
  // AI: keeps the user's Good tier verbatim and fills Better/Best from the
  // trade seed matching the job wording (Good's lines + the AI-describe text +
  // the lead's job), else the generic fallback derived from Good's lines.
  function suggestBetterBest() {
    setCs((prev) => {
      if (prev.format !== "gbb" || !prev.gbb) return prev;
      const good = prev.gbb.opts.find((o) => o.k === "good") ?? prev.gbb.opts[0];
      if (!good) return prev;
      const jobText = [
        good.lines.map((l) => l.d).join(" "),
        prev.desc,
        selectedLead?.job ?? "",
      ].join(" ");
      // Replaces Better & Best (the quote card confirms first when they hold
      // real lines); the star preservation rule lives in suggestFromGood.
      // Any format-switch note is stale after the rewrite.
      return { ...prev, gbb: suggestFromGood(prev.gbb, jobText), switchNote: null };
    });
  }

  // Default the send channel from the customer's contact info, once per lead:
  // text when they have a mobile on file (or nothing yet), email when email is
  // all we have. A manual toggle after that sticks until the customer changes.
  const channelDefaultedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedLead) return;
    if (channelDefaultedFor.current === selectedLead.id) return;
    channelDefaultedFor.current = selectedLead.id;
    const hasPhone = !!selectedLead.phone && selectedLead.phone !== "—";
    const hasEmail = !!selectedLead.email;
    setCs((prev) => ({
      ...prev,
      sendChannel: !hasPhone && hasEmail ? "email" : "text",
    }));
  }, [selectedLead]);

  // Held traces persist as REAL site captures only when this quote's flow has
  // a job to anchor them to (site_captures FK jobs) — a ?job= boot or a
  // ?change= change order. An ordinary new quote produces an estimate, not a
  // job (the job is created at ACCEPT, server-side), so its held traces have
  // no anchor: the measured value survives as the seeded estimate lines, the
  // raw trace geometry evaporates with the composer — deliberate, documented.
  // Best-effort AFTER a successful send/save: the quote is already persisted,
  // so a failed capture write must not fail the flow — the slice reports it
  // (reportWriteError) and the trace simply stays quote-local.
  async function persistHeldTraces() {
    const anchorJobId = jobId ?? changeOrderJobId;
    if (!anchorJobId || cs.heldTraces.length === 0) return;
    const addTracedSite = useAppStore.getState().addTracedSite;
    await Promise.allSettled(
      cs.heldTraces.map((t) =>
        addTracedSite({
          jobId: anchorJobId,
          name: t.name,
          surface: t.surface,
          pitchRise: t.surface === "pitched" ? (t.pitchRise ?? undefined) : undefined,
          // The whole polygon rides along — including the roof edge
          // classification (edgeClasses/interiorLines), which the server
          // re-derives the per-class linears from.
          polygon: { ...t.polygon, vertices: [...t.polygon.vertices], view: { ...t.polygon.view } },
          footprintSqft: t.footprintSqft,
          perimeterLnft: t.perimeterLnft,
        }),
      ),
    );
  }

  // --- persistence helpers --------------------------------------------------
  // The action buttons disable (with the reason inline) while these guards
  // fail — the early returns are defense-in-depth, not the primary gate.
  // ALL of them derive the payload at call time; a GBB quote always carries
  // the full three-tier structure (gating keys off the recommended tier).

  // Preview has to persist a draft to mint the public token the customer page reads, so every
  // Preview leaves a REAL Draft in the ledger. Both terminal actions supersede those drafts, and
  // both archive them here — best-effort: a failed archive leaves a draft the office can trash
  // from the estimate modal, and must not fail a quote that is already saved or sent. The ref is
  // cleared so a later action can't archive the same id twice.
  function archivePreviewDrafts() {
    for (const p of previewDraftsRef.current) {
      quoteArchiveMutation.mutate(
        { estimateId: p.id },
        {
          onError: (err) => {
            if (process.env.NODE_ENV !== "production") {
              console.error("[composer] preview-draft archive failed", { estimateId: p.id, err });
            }
          },
        },
      );
    }
    previewDraftsRef.current = [];
  }

  async function saveDraftComposer() {
    // Gate on the recommended tier's real lines (mirrors the domain's send
    // rule) — the server's draft schema rejects `description: ""`.
    if (realLines(linesForSend(cs)).length === 0) return;
    // Draft requires a lead: the estimate hangs off a real leadId.
    if (!selectedLead) return;
    if (isSavingDraft) return; // in-flight guard: a second click would mint a second draft

    setSendError(null);
    setIsSavingDraft(true);
    try {
      // The SAME payload the send and preview paths draft with — one builder, so a draft saved
      // here and the same quote sent later reach the server as the same estimate.
      const drafted = await quoteDraftMutation.mutateAsync(buildDraftPayload(selectedLead));
      // The server holds it; adopt the returned record rather than re-persisting through
      // addEstimate, which would orphan a duplicate draft in the shop rail.
      adoptEstimate(drafted, { on: cs.fuOn, stage: 0 });
      archivePreviewDrafts();
      // Traces held on this quote persist onto the flow's job when one exists
      // (?job=/?change=) — fire-and-forget; the draft is already saved.
      void persistHeldTraces();
      // Quotes live on the work board on the Office page (the /quotes and /pipeline routes
      // just redirect there); the new draft lands in the "in the shop" lane.
      //
      // The redirect happens HERE, after the server has the record. It used to fire in the same
      // tick as an optimistic store write: a refused payload (a discount past 10000 bps, a
      // dropped connection) rolled back on a page nobody was on any more, so the app reported a
      // save and the quote was gone.
      router.push("/dashboard");
    } catch (e: unknown) {
      const code = (e as { data?: { code?: string } }).data?.code;
      setSendError(
        code === "BAD_REQUEST"
          ? "Draft not saved — the server refused these details. Check the pricing figures and the line items, then save again."
          : "Draft not saved — check your connection and try again.",
      );
    } finally {
      setIsSavingDraft(false);
    }
  }

  // The v1.quoting.draft payload built from the current composer state — shared by the
  // send flow and the preview flow so they draft an identical estimate. A GBB quote
  // carries ALL tiers' lines (tier-tagged) + recommendedTier + tierNames; the customer
  // picks one of the three options on their quote page. termsSnapshot rides both formats.
  function buildDraftPayload(lead: NonNullable<typeof selectedLead>) {
    const gbb = cs.format === "gbb" && cs.gbb ? cs.gbb : null;
    // Headings whose name was cleared are dropped here, with their lines re-pointed — the
    // server refuses a blank one, and an emptied name should not fail the whole save.
    const grouped = sectionsForPayload(cs.sections, cs.lines);
    const payloadLines: (ComposerLine & { tier?: TierKey })[] = gbb
      ? tieredLinesForPayload(gbb)
      : realLines(grouped.lines);
    return {
      leadId: lead.id,
      // NAMED AFTER THE WORK. "Quote" was the fallback when the customer record had no job
      // description — and that name follows the quote onto the JOB it becomes, so a scheduling
      // board ends up with rows called "Quote" that tell a dispatcher nothing about what the truck
      // is going out for. The first line item is what the work actually is.
      title: lead.job?.trim() || payloadLines[0]?.d?.trim() || "Quote",
      discBps: Math.round((cs.pricing.disc ?? 0) * 100),
      taxBps: Math.round((cs.pricing.tax ?? 0) * 100),
      depBps: Math.round((cs.pricing.dep ?? 0) * 100),
      validDays: cs.validDays,
      lines: payloadLines.map(lineToPayload),
      // Headings only travel with a single quote: three tiers with one heading list would be
      // three competing groupings of the same document.
      ...(gbb === null && grouped.sections.length > 0
        ? { sections: grouped.sections.map((name) => ({ name })) }
        : {}),
      // The shop's own costs. Blank rows are dropped the way blank lines are — a cost with
      // nothing written on it is scaffolding, and the server refuses it anyway.
      ...(realJobCosts(cs.jobCosts).length > 0
        ? {
            jobCosts: realJobCosts(cs.jobCosts).map((cost) => ({
              description: cost.d,
              amountCents: Math.round((cost.amt ?? 0) * 100),
              ...(cost.poId ? { purchaseOrderId: cost.poId } : {}),
            })),
          }
        : {}),
      // Which numbers the customer sees — 'lines' is the historical default, 'total' the
      // proposal format ($ chip on the line-table header).
      priceDisplay: cs.priceDisplay,
      // The designed pages frozen onto this quote — ON pages only; absent = plain quote.
      ...(() => {
        const snapshot = presentationSnapshotForPayload(cs.presentation);
        return snapshot ? { presentationSnapshot: snapshot } : {};
      })(),
      ...(gbb
        ? { recommendedTier: gbb.rec, tierNames: tierNamesForPayload(gbb) }
        : {}),
      ...(cs.terms?.text.trim() ? { termsSnapshot: cs.terms.text } : {}),
      // A quote raised from inside a RUNNING job is a change order: it adds work to that job, and
      // the signature it collects is what makes the extra authorised rather than a surprise on the
      // bill. ?change=<jobId> marks it; an ordinary quote sends nothing.
      ...(changeOrderJobId ? { changeOrderForJobId: changeOrderJobId } : {}),
      // The scope-visit job this quote prices (?job=). Accept converts that job into the sold
      // work — the walkthrough and the work stay ONE job. Server-validated (org + kind).
      ...(cs.jobId ? { jobId: cs.jobId } : {}),
      // AI-originated quotes carry the AI's original lines so the server can
      // diff what the office changed (edit-delta mining → proposed rules).
      ...(() => {
        const aiDraft = aiDraftForPayload(cs);
        return aiDraft ? { aiDraft } : {};
      })(),
    };
  }

  async function sendComposer() {
    if (!selectedLead) return; // send requires a lead
    if (!hasRealLine(linesForSend(cs))) return;
    // Send-only gate: no destination on file for the chosen channel. The Send
    // button disables with the reason; this early return is defense-in-depth —
    // a destination-less send would persist + mark the estimate sent, then
    // fail delivery with a misleading error, and a retry would mint a
    // duplicate estimate.
    if (deliveryGateReason(cs.sendChannel, selectedLead) != null) return;
    // Same defense-in-depth for the carrier gate: a quote sent by TEXT on a shop whose 10DLC
    // campaign isn't active persists the estimate, marks it sent, and then fails delivery — the
    // customer never hears about a quote the pipeline says they were sent.
    if (cs.sendChannel === "text" && !smsGate.ready) return;

    setSendError(null);
    setIsSending(true);

    try {
      // Step 1: persist the estimate draft. The backend generates a publicToken.
      const drafted = await quoteDraftMutation.mutateAsync(buildDraftPayload(selectedLead));

      // Step 2: mark the estimate as sent (stamps sentAt). Returns the SENT dto.
      const sentDto = await quoteSendMutation.mutateAsync({ estimateId: drafted.id });

      // Step 3: deliver the quote link via the selected channel.
      // The public link is /q/<token>. Use the current origin so it works in
      // any environment (dev / staging / prod) without a server-only env var.
      const appOrigin = typeof window !== "undefined" ? window.location.origin : "";
      const quoteLink =
        drafted.publicToken
          ? `${appOrigin}/q/${drafted.publicToken}`
          : appOrigin; // fallback if token not yet set (shouldn't happen)

      // The intro from the Message card (or the auto-intro fallback) leads the
      // body on both channels.
      const body = buildQuoteMessageBody({
        firstName: selectedLead.name.split(" ")[0] ?? selectedLead.name,
        intro: cs.intro,
        quoteNum: drafted.num,
        quoteLink,
      });

      if (cs.sendChannel === "text") {
        // SMS — gated: requires Twilio + A2P. Server returns PRECONDITION_FAILED
        // when unconfigured (no number provisioned). Wire the call regardless;
        // error is shown inline so the user knows delivery didn't go out.
        await messagingSendMutation.mutateAsync({
          leadId: selectedLead.id,
          body,
        });
      } else {
        // Email — deliver the quote link via the notifications sender (Resend). Gated
        // server-side on RESEND_API_KEY + EMAIL_FROM; a PRECONDITION_FAILED means email
        // isn't configured (caught below and surfaced inline — the quote is still saved).
        await notificationsSendMutation.mutateAsync({
          channel: "email",
          to: selectedLead.email ?? "",
          kind: "estimate_sent",
          body,
          relatedType: "estimate",
          relatedId: drafted.id,
          idempotencyKey: `estimate-sent-${drafted.id}`,
        });
      }

      // Store update so the pipeline reflects the new estimate. Adopt the SERVER's
      // sent record — the draft+send above already persisted it; going through
      // addEstimate here would fire a second quoting.draft and orphan a duplicate
      // draft in the shop rail.
      adoptEstimate(sentDto, { on: cs.fuOn, stage: 0 });

      // Traces held on this quote persist onto the flow's job when one exists
      // (?job=/?change=). Awaited so the job's captures are visible the moment
      // the pipeline shows the sent quote; failures stay non-fatal (allSettled).
      await persistHeldTraces();

      // A successful send of a REVISION supersedes the original sent quote —
      // archive it so two versions of the same work never sit in the rail. The
      // store patch routes through v1.quoting.archive (see estimates-slice).
      if (reviseId && seededForRevise.current === reviseId) {
        useAppStore.getState().updateEstimate(reviseId, { archived: true });
      }

      // Preview drafts from this composer session are superseded by the real send.
      archivePreviewDrafts();

      addLeadNote(selectedLead.id, {
        type: "text",
        from: "auto",
        t: `Your quote ${drafted.num} is ready — view and approve.`,
        when: "Just now",
      });

      if (
        STAGE_ORDER.indexOf(selectedLead.stage as (typeof STAGE_ORDER)[number]) <
        STAGE_ORDER.indexOf("Quote Sent")
      ) {
        moveLeadStage(selectedLead.id, "Quote Sent");
      }

      router.push("/dashboard");
    } catch (e: unknown) {
      // Surface the error inline. A PRECONDITION_FAILED from messaging means the
      // quote was persisted + marked sent — only delivery failed.
      const code = (e as { data?: { code?: string } }).data?.code;
      if (code === "PRECONDITION_FAILED") {
        setSendError(
          cs.sendChannel === "text"
            ? "Quote saved — but no business number is set up for texting yet. Share the link manually."
            : "Quote saved — email delivery isn't configured yet. Share the link manually.",
        );
      } else if (code === "BAD_GATEWAY") {
        // The provider rejected the send (e.g. Resend refused the from-address/key).
        setSendError(
          cs.sendChannel === "text"
            ? "Quote saved — the texting provider rejected the send. Check the Twilio setup."
            : "Quote saved — the email provider rejected the send. Check EMAIL_FROM and the Resend key.",
        );
      } else {
        setSendError("Couldn't send the quote — check your connection and try again.");
      }
    } finally {
      setIsSending(false);
    }
  }

  // Preview: persist a draft to mint a public token, then open the customer-facing
  // quote page (/q/<token>) in a new tab — the exact view the customer will see.
  // In GBB format that includes the three-option tier picker.
  async function previewComposer() {
    if (!selectedLead) return;
    if (!hasRealLine(linesForSend(cs))) return;
    setSendError(null);
    try {
      const payload = buildDraftPayload(selectedLead);
      // One preview draft per distinct composer state: re-clicking Preview without
      // changing anything reuses the same draft instead of persisting another one.
      const key = JSON.stringify(payload);
      const appOrigin = typeof window !== "undefined" ? window.location.origin : "";
      const cached = previewDraftsRef.current.find((p) => p.key === key);
      if (cached?.token) {
        window.open(`${appOrigin}/q/${cached.token}`, "_blank", "noopener");
        return;
      }
      const drafted = await quoteDraftMutation.mutateAsync(payload);
      previewDraftsRef.current.push({ key, id: drafted.id, token: drafted.publicToken ?? null });
      if (drafted.publicToken) {
        window.open(`${appOrigin}/q/${drafted.publicToken}`, "_blank", "noopener");
      }
    } catch {
      setSendError("Couldn't open the preview — check your connection and try again.");
    }
  }

  async function composerNewCust() {
    // In-flight guard: if a create is already pending (e.g. the user double-
    // clicked or hit Enter twice), drop the extra invocation immediately so we
    // never fire two concurrent creates for the same name.
    if (createCustomerMutation.isPending) return;

    const name = cs.custQuery.trim();
    if (!name) return;

    // Client-side dedupe: if a lead with this name (case-insensitive) already
    // exists in the store, select it instead of creating a duplicate.
    const nameLower = name.toLowerCase();
    const existing = leads.find((l) => (l.name ?? "").trim().toLowerCase() === nameLower);
    if (existing) {
      update({ leadId: existing.id, custQuery: "" });
      return;
    }

    setCustError(null);
    try {
      // Persist a real DB lead (server assigns the id). Without this the quote's
      // leadId would point at a row that doesn't exist and the draft/send would
      // be rejected server-side and silently rolled back.
      const data = await createCustomerMutation.mutateAsync({
        name,
        source: "Added manually",
      });
      // Refetch the customer list so the leads hydrator writes the new lead into
      // the store; then select it by its server id.
      await utils.v1.customers.invalidate();
      update({ leadId: data.id, custQuery: "" });
    } catch {
      setCustError("Couldn't add the customer — check your connection and try again.");
    }
  }

  // Gate inputs for the send card: tier label (falls back when a custom name
  // trims empty) + the chosen channel's destination check (gates Send only).
  const recTier = recommendedTier(cs);
  const recTierName = recTier ? tierDisplayName(recTier) : null;

  return (
    <div>
      <h1>New quote</h1>

      {/* Two full-page tabs, like the office page: Estimate = build the numbers & scope;
          Presentation = the designed pages the customer opens. The Estimate pane stays MOUNTED
          (hidden, not unmounted) so QuoteCard-local state survives tab switches. */}
      <div className="otabs" role="tablist" aria-label="Quote">
        <button
          className={tab === "estimate" ? "otab on" : "otab"}
          role="tab"
          aria-selected={tab === "estimate"}
          onClick={() => switchTab("estimate")}
        >
          Estimate
        </button>
        <button
          className={tab === "presentation" ? "otab on" : "otab"}
          role="tab"
          aria-selected={tab === "presentation"}
          onClick={() => switchTab("presentation")}
        >
          Presentation
          {cs.presentation && <span className="pill green">on</span>}
        </button>
      </div>

      <div hidden={tab !== "presentation"}>
        {/* Mounted even while hidden — the page editor holds unsaved copy in component state, and
            unmounting on a tab switch threw away whatever the office had typed. Same rule as the
            Estimate pane below. */}
        <PresentationTab
          state={cs}
          onUpdate={update}
          leadName={selectedLead?.name ?? null}
          leadJob={selectedLead?.job ?? null}
          onGoToEstimate={() => switchTab("estimate")}
        />
      </div>

      <div hidden={tab !== "estimate"}>
      <CustomerSelector
        state={cs}
        onUpdate={update}
        leads={leads}
        onNewCust={composerNewCust}
        isAddingCust={createCustomerMutation.isPending}
      />
      {custError && (
        <p style={{ color: "var(--red, #b42318)", fontSize: "var(--type-base)", margin: "-8px 0 var(--space-3)" }}>
          {custError}
        </p>
      )}

      {jobId && buildFromMeasurementsQuery.isError && (
        <p
          role="alert"
          style={{ color: "var(--red, #b42318)", fontSize: "var(--type-base)", margin: "-8px 0 var(--space-3)" }}
        >
          Couldn't build the price from this job's measurements — check your connection and try again.
        </p>
      )}

      {measurementNotice &&
        (measurementNotice.gaps.length > 0 || measurementNotice.unconfirmedRooms.length > 0) && (
          <div
            style={{
              fontSize: "var(--type-base)",
              color: "var(--ink-3)",
              margin: "-8px 0 var(--space-3)",
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-1)",
            }}
          >
            {measurementNotice.gaps.map((gap) => (
              <p key={gap.kind} style={{ margin: 0 }}>
                {gapNoticeText(gap)}
              </p>
            ))}
            {unconfirmedRoomsNoticeText(measurementNotice.unconfirmedRooms.length) && (
              <p style={{ margin: 0 }}>
                {unconfirmedRoomsNoticeText(measurementNotice.unconfirmedRooms.length)}
              </p>
            )}
          </div>
        )}

      {/* What the technician brought back — read before pricing. Renders only when the picked
          customer has a scoped walkthrough (the tech→office estimating lane). */}
      <SiteReference leadId={cs.leadId} />

      {/* Measure — satellite measurement's point of entry, always available on
          the quote page (no customer or job needed; org toggle gates it). A
          trace made here is HELD on this quote (cs.heldTraces) and seeded
          client-side; a picked customer's measured jobs still list their
          capture rows. A ?job= boot has already seeded the whole job, so its
          rows start "Seeded". */}
      <MeasuredSurfacesPanel
        paramJobId={jobId}
        leadId={cs.leadId}
        wholeJobSeeded={measurementNotice !== null}
        heldTraces={cs.heldTraces}
        onAddHeldTrace={(trace) => setCs((prev) => addHeldTrace(prev, trace))}
        onSeedLines={(lines) =>
          setCs((prev) => appendMeasurementLines(prev, seedLinesToComposerLines(lines)))
        }
      />

      {/* The quote — format toggle, authoring tools, line editor / tier panels */}
      <QuoteCard
        state={cs}
        onUpdate={update}
        materials={materials}
        onAiDraft={triggerAiDraft}
        onRefine={triggerRefine}
        proposals={proposals}
        onAcceptProposal={(id) => void acceptProposal(id)}
        onDismissProposal={dismissProposal}
        proposalError={proposalError}
        onSuggestBetterBest={suggestBetterBest}
        isDrafting={draftEstimateMutation.isPending || draftTiersMutation.isPending}
        aiDraftError={aiDraftError}
        services={services}
        savedAssemblies={savedAssemblies}
        onSaveAssembly={saveAssembly}
        run={
          run
            ? {
                hasLead: Boolean(run.leadId),
                gather: gatherQuery.data
                  ? { ...gatherQuery.data.counts, source: gatherQuery.data.lead?.source ?? null }
                  : null,
                pricebook: { services: services.length, laborRates: laborRates.length },
                result: runResult,
              }
            : null
        }
        onRunDone={finishRun}
        materialize={materialize}
      />

      {/* Pricing — discount, deposit, tax */}
      <PricingCard state={cs} onUpdate={update} />

      {/* Message — intro + valid days */}
      <MessageCard state={cs} onUpdate={update} lead={selectedLead} />

      {/* Send — channel, destination, follow-ups, actions (the last act) */}
      <SendCard
        lead={selectedLead}
        state={cs}
        onUpdate={update}
        gateReason={sendGateReason(selectedLead != null, linesForSend(cs), recTierName)}
        deliveryGateReason={
          selectedLead != null
            ? // The carrier gate outranks the destination gate: a number on file is no use if the
              // shop cannot text at all, and naming the missing destination first would send the
              // owner hunting for a phone number that was there all along.
              (cs.sendChannel === "text" && !smsGate.ready
                ? smsGate.note
                : deliveryGateReason(cs.sendChannel, selectedLead))
            : null
        }
        isSending={isSending}
        isSavingDraft={isSavingDraft}
        sendError={sendError}
        onPreview={previewComposer}
        onSaveDraft={saveDraftComposer}
        onSend={sendComposer}
      />
      </div>
    </div>
  );
}
