import { z } from "zod";
import { loadConfig, resolvePublicAppOrigin } from "@mallet/shared/config";
import { TRPCError } from "@trpc/server";
import { router, ownerOrOffice } from "@/trpc/init";
import { orThrow } from "@/trpc/errors";
import { asEstimateId, asJobId, asLeadId, toPage, type OrgId } from "@mallet/shared/types";
import type { TenantTx } from "@mallet/shared/db/tx";
import { ESTIMATE_STATUSES, type Estimate, type EstimateStatus } from "../domain/estimate";
import type { QuoteTier } from "../domain/estimate";
import { DrizzleEstimateRepository } from "../infra/drizzle-estimate-repository";
import { DraftEstimateUseCase } from "../app/draft-estimate";
import { SendEstimateUseCase } from "../app/send-estimate";
import { AcceptEstimateUseCase } from "../app/accept-estimate";
import { DeclineEstimateUseCase } from "../app/decline-estimate";
import { ESTIMATE_SORTS } from "../infra/estimate-sorts";
import { ListEstimatesUseCase } from "../app/list-estimates";
import { ClearEstimateChangeRequestUseCase } from "../app/clear-estimate-change-request";
import { DrizzleJobRepository, DrizzleEstimateReader, CreateJobFromEstimateUseCase, jobSummaryDTO, toJobSummaryDTO } from "@mallet/jobs";
import { DrizzleLeadRepository } from "@mallet/customers";
import { logger } from "@mallet/shared/observability";
import { runInSavepoint } from "./savepoint";
import { createQuotingRulesRouter } from "./quoting-rules-router";
import { MineEditDeltasUseCase } from "../app/mine-edit-deltas";
import { DrizzleQuotingRuleRepository } from "../infra/drizzle-quoting-rule-repository";
import { DrizzleServiceNameReader } from "../infra/drizzle-service-name-reader";
import { DrizzleRateServicesReader } from "../infra/drizzle-rate-services-reader";
import { DrizzleJobLeadReader } from "../infra/drizzle-job-lead-reader";
import { BuildFromMeasurementsUseCase } from "../app/build-from-measurements";
import {
  MeasurementRoomQuantitiesReader,
  MeasurementSiteQuantitiesReader,
  DrizzleMeasurementRepository,
} from "@mallet/measurements";

const statusEnum = z.enum(ESTIMATE_STATUSES as unknown as [EstimateStatus, ...EstimateStatus[]]);
const moneyDTO = z.object({ cents: z.number().int(), currency: z.literal("USD") });
// Mirrors the DB CHECK on estimates.recommended_tier / accepted_tier / estimate_lines.tier.
const tierEnum = z.enum(["good", "better", "best"]) satisfies z.ZodType<QuoteTier>;
// Output shape (plain strings — never transforms/rejects stored data).
const tierNamesDTO = z.object({ good: z.string(), better: z.string(), best: z.string() });
// Input shape (boundary-validated display names).
const tierNamesInput = z.object({
  good: z.string().trim().min(1).max(60),
  better: z.string().trim().min(1).max(60),
  best: z.string().trim().min(1).max(60),
});

const estimateLineDTO = z.object({
  id: z.string().uuid(),
  description: z.string(),
  quantity: z.number(),
  rate: moneyDTO,
  cost: moneyDTO,
  isOptional: z.boolean(),
  needsPhoto: z.boolean(),
  /** Does this line take sales tax. The estimate's taxBps is charged on the taxable, non-optional
   *  lines only — see Estimate.taxableBaseOf. */
  taxable: z.boolean(),
  position: z.number().int(),
  tier: tierEnum.nullable(),
});

const estimateDTO = z.object({
  id: z.string().uuid(),
  num: z.string(),
  leadId: z.string().uuid(),
  title: z.string().nullable(),
  status: statusEnum,
  discBps: z.number().int(),
  taxBps: z.number().int(),
  depBps: z.number().int(),
  lines: z.array(estimateLineDTO),
  subtotal: moneyDTO,
  discount: moneyDTO,
  tax: moneyDTO,
  total: moneyDTO,
  depositDue: moneyDTO,
  // What has actually been COLLECTED, summed from the quote's deposit ledger. Distinct from
  // depositDue (the ASK) and shipped alongside it because the office had no way to see a landed
  // deposit at all — it only appeared once the final invoice netted it out, which is exactly what
  // let a whole class of deposit bugs sit unnoticed.
  depositPaid: moneyDTO,
  validDays: z.number().int().nullable(),
  sentAt: z.string().nullable(),
  // Is the shop still chasing this one, and how many nudges in.
  followUpOn: z.boolean(),
  followUpStage: z.number().int(),
  acceptedAt: z.string().nullable(),
  declinedAt: z.string().nullable(),
  declineReason: z.string().nullable(),
  changeRequestedAt: z.string().nullable(),
  changeRequest: z.string().nullable(),
  /** The scope-visit job this quote prices, when it came from a walkthrough. Accept converts it. */
  jobId: z.string().uuid().nullable(),
  // Good/Better/Best: non-null recommendedTier marks a tiered quote; acceptedTier records the
  // customer's (or office's) resolved choice; tierNames are the display labels; termsSnapshot
  // is the terms text frozen at draft time.
  recommendedTier: tierEnum.nullable(),
  acceptedTier: tierEnum.nullable(),
  tierNames: tierNamesDTO.nullable(),
  termsSnapshot: z.string().nullable(),
  // The unguessable public_token generated at draft time. Never exposed to end-customers via
  // this authed endpoint — they receive only the link, not the ability to enumerate tokens.
  publicToken: z.string().nullable(),
  /**
   * The FINISHED customer-facing link. Composed here, on the server, rather than by the client.
   *
   * The client used to build it from `window.location.origin` — whatever URL the shop happened to
   * be on when they pressed Send. That is only correct by luck: a preview/deployment URL, a branch
   * alias, a future custom domain or a localhost demo each produce a link the customer cannot open.
   * It happened: a quote sent from a Vercel deployment URL emailed a link behind Vercel's own login
   * wall, which opened fine on the sender's laptop and asked a customer to sign in to Vercel.
   *
   * Null only when no canonical origin can be resolved at all (see resolvePublicAppOrigin), which
   * the send path treats as a refusal — a quote nobody can open converts at zero, so failing loudly
   * beats sending a broken link.
   */
  publicUrl: z.string().nullable(),
  /**
   * The customer's signature, or null when nobody signed.
   *
   * Null is a real and different state from "accepted": the office can mark a quote accepted after
   * a phone call, and that is a legitimate acceptance with no signature behind it. The UI must
   * present the two differently — telling a shop it holds evidence when it holds a status field is
   * worse than showing nothing, because it is the screen they check before chasing a balance.
   *
   * Sent to AUTHENTICATED org users only. This route is `ownerOrOffice` and the estimate is
   * org-scoped, so the shop receives evidence about its own customer. The customer-facing route
   * (app/api/public/quote/[token]) does NOT carry any of this — a token holder must never be able
   * to read back the IP and user agent captured about them.
   */
  signature: z
    .object({
      signerName: z.string(),
      /** SVG path data, or null when they signed by typing their name only. */
      signatureSvg: z.string().nullable(),
      signerIp: z.string().nullable(),
      signerUserAgent: z.string().nullable(),
      signedAt: z.string(),
      /** The document as it stood when signed — totals here, NOT the live ones. */
      snapshot: z.object({
        estimateNum: z.string(),
        totalCents: z.number().int(),
        depositCents: z.number().int(),
        chosenTier: z.string().nullable(),
        authorizationText: z.string(),
        lines: z.array(
          z.object({
            description: z.string(),
            quantity: z.number(),
            rateCents: z.number().int(),
          }),
        ),
      }),
    })
    .nullable(),
  createdAt: z.string(),
});

// Lighter shape for list views — no line detail, but the derived total for display.
const estimateSummaryDTO = z.object({
  id: z.string().uuid(),
  num: z.string(),
  leadId: z.string().uuid(),
  /**
   * The customer's name, resolved SERVER-side.
   *
   * The Pipeline's Out and Won columns paired each quote with its customer by searching the
   * browser's loaded customers. Both collections are capped, so a quote whose customer had not
   * loaded was DROPPED from the column entirely — silently, and more often the bigger the book
   * got, leaving a header count that did not match the cards under it. Same fault that showed $0
   * of quotes out while $29,722 genuinely was. Sending the name removes the lookup.
   */
  customerName: z.string().nullable(),
  title: z.string().nullable(),
  status: statusEnum,
  total: moneyDTO,
  createdAt: z.string(),
  // Share-link token — carried on summaries so list-hydrated estimates can be
  // sent by text/email from the estimate modal.
  publicToken: z.string().nullable(),
  /** The finished customer-facing link, composed server-side. See the full DTO for why. */
  publicUrl: z.string().nullable(),
  changeRequestedAt: z.string().nullable(),
  // Tier fields on summaries too — the modal/rails show "3 options · recommended Better"
  // pre-accept and "Accepted: Best" post-accept from list-hydrated data.
  recommendedTier: tierEnum.nullable(),
  acceptedTier: tierEnum.nullable(),
  tierNames: tierNamesDTO.nullable(),
  termsSnapshot: z.string().nullable(),
  /**
   * Whether a customer actually signed — a boolean, not the evidence.
   *
   * The list is what the quote rows in the lead modal render from, and those rows must be able to
   * tell "Signed" from "Accepted" without waiting for a full fetch. Without this the pill would
   * quietly say "Accepted" on every signed quote until the modal opened and hydrated, which is a
   * safer error than the reverse but is still wrong on the screen a shop scans first.
   *
   * Deliberately NOT the signature itself: a list page would then carry the name, IP and frozen
   * snapshot of every customer in one response, which is a lot of evidence to ship for a pill.
   */
  signed: z.boolean(),
  followUpOn: z.boolean(),
  followUpStage: z.number().int(),
});

const lineInput = z.object({
  description: z.string().min(1),
  quantity: z.number().nonnegative(),
  rateCents: z.number().int().nonnegative(),
  costCents: z.number().int().nonnegative().optional(),
  isOptional: z.boolean().optional(),
  needsPhoto: z.boolean().optional(),
  /** Seeded by the composer from the pricebook item/material; omitted it reads as TRUE. */
  taxable: z.boolean().optional(),
  tier: tierEnum.optional(),
  // Provenance pointer when the line came from a pricebook material (sellable parts).
  materialId: z.string().uuid().nullable().optional(),
});

const draftInput = z
  .object({
    leadId: z.string().uuid(),
    title: z.string().optional(),
    discBps: z.number().int().min(0).max(10_000).optional(),
    taxBps: z.number().int().min(0).optional(),
    depBps: z.number().int().min(0).max(10_000).optional(),
    validDays: z.number().int().positive().optional(),
    lines: z.array(lineInput).min(1),
    recommendedTier: tierEnum.optional(),
    tierNames: tierNamesInput.optional(),
    termsSnapshot: z.string().trim().min(1).max(10_000).optional(),
    /**
     * The job this quote adds work to — makes it a CHANGE ORDER.
     *
     * Sent when the quote was raised from inside a running job. The quote is otherwise ordinary:
     * priced, sent, and SIGNED the same way, which is the point — the customer agrees to the extra
     * exactly as they agreed to the original, so the invoice can prove it.
     */
    changeOrderForJobId: z.string().uuid().optional(),
    /**
     * The scope-visit job this quote prices — the walkthrough the composer was opened from
     * (?job= on the scoped pipeline card). Accept CONVERTS that job into the sold work instead
     * of minting a duplicate. Client input: validated in the resolver against an org-scoped read
     * (must exist in this org and still be kind='estimate') before it is stored.
     */
    jobId: z.string().uuid().optional(),
    // The AI drafter's ORIGINAL lines — sent only when this draft originated from the AI.
    // Persisted write-once to estimates.ai_draft; the send path diffs it against the lines
    // actually sent (edit-delta mining → proposed quoting_rules).
    aiDraft: z
      .object({
        lines: z
          .array(
            z.object({
              description: z.string().min(1).max(500),
              // .finite() is explicit belt-and-braces: superjson round-trips
              // Infinity, and an Infinity quantity in the jsonb snapshot
              // serializes to null — the miner would then mint junk rules
              // ("usually takes 5, not null"). Zod 4 already rejects
              // non-finite numbers; this pins the behavior against upgrades.
              quantity: z.number().nonnegative().finite(),
              rateCents: z.number().int().nonnegative(),
              tier: tierEnum.optional(),
            }),
          )
          .min(1)
          .max(30),
      })
      .optional(),
  })
  // Boundary consistency: a tiered draft tags EVERY line; a single draft tags none and
  // carries no tier names. (The domain re-validates — this just fails fast with a clear path.)
  .superRefine((val, ctx) => {
    if (val.recommendedTier) {
      if (val.lines.some((line) => !line.tier)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "every line needs a tier when recommendedTier is set",
          path: ["lines"],
        });
      }
      return;
    }
    if (val.lines.some((line) => line.tier)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "tiered lines require recommendedTier",
        path: ["recommendedTier"],
      });
    }
    if (val.tierNames) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "tierNames require recommendedTier",
        path: ["tierNames"],
      });
    }
  });

const listInput = z.object({
  limit: z.number().int().positive().max(500).optional(),
  cursor: z.string().nullish(),
  status: statusEnum.optional(),
  /** Named sort — never a column name. Absent keeps the historical newest-first ordering. */
  sort: z.enum(ESTIMATE_SORTS).optional(),
  sortDir: z.enum(["asc", "desc"]).optional(),
});

const idInput = z.object({ estimateId: z.string().uuid() });
const acceptInput = z.object({
  estimateId: z.string().uuid(),
  /** Optional customer-tuned lines to commit before accepting. Sent as rateCents/costCents
   *  (integer cents) — the client converts store dollars × 100 before calling. */
  lines: z.array(lineInput).optional(),
  /** Good/Better/Best choice. Omitted on a tiered estimate → defaults to the recommended
   *  tier (office accept). Rejected on single-format estimates. */
  chosenTier: tierEnum.optional(),
});
const declineInput = z.object({ estimateId: z.string().uuid(), reason: z.string().min(1) });
const listByLeadInput = z.object({
  leadId: z.string().uuid(),
  limit: z.number().int().positive().max(500).optional(),
  cursor: z.string().nullish(),
});
const paginatedSummaryDTO = z.object({
  items: z.array(estimateSummaryDTO),
  nextCursor: z.string().nullable(),
});

const buildFromMeasurementsInput = z.object({
  jobId: z.string().uuid(),
  // Optional per-capture filter (the composer's per-surface "Seed lines"): capture names —
  // a room's roomName / a site's stored name. Absent = whole-job seed (unchanged behavior).
  sourceNames: z.array(z.string().min(1).max(80)).max(50).optional(),
});
// Mirrors modules/pricebook/api/pricebook-dto.ts's measuredByKindDTO — kept as its own literal
// zod enum (rather than importing pricebook) so this boundary schema stays a leaf, same
// rationale as that file's own comment.
const measuredKindDTO = z.enum([
  "walls_sqft",
  "ceiling_sqft",
  "soffit_sqft",
  "baseboard_lnft",
  "baseboard_sqft",
  "crown_lnft",
  "crown_sqft",
  "doors_count",
  "windows_count",
  "site_sqft",
  "site_lnft",
]);
const buildFromMeasurementsOutput = z.object({
  leadId: z.string().uuid(),
  seedLines: z.array(
    z.object({
      description: z.string(),
      quantity: z.number(),
      rateCents: z.number().int(),
      costCents: z.number().int(),
      measuredKind: measuredKindDTO,
      // Provenance: the room (painting kinds) or traced surface (site kinds) the quantity
      // came from.
      sourceName: z.string(),
      serviceId: z.string().uuid(),
    }),
  ),
  gaps: z.array(z.object({ kind: measuredKindDTO, label: z.string() })),
  unconfirmedRooms: z.array(z.string()),
});

const money = (cents: number) => ({ cents, currency: "USD" as const });

const toEstimateDTO = (estimate: Estimate) => {
  const p = estimate.props;
  return {
    id: p.id,
    num: p.num,
    leadId: p.leadId,
    title: p.title,
    status: p.status,
    discBps: p.discBps,
    taxBps: p.taxBps,
    depBps: p.depBps,
    lines: p.lines.map((line) => {
      const lp = line.props;
      return {
        id: lp.id,
        description: lp.description,
        quantity: lp.quantity,
        rate: money(lp.rate),
        cost: money(lp.cost),
        isOptional: lp.isOptional,
        needsPhoto: lp.needsPhoto,
        taxable: lp.taxable,
        position: lp.position,
        tier: lp.tier,
      };
    }),
    subtotal: money(estimate.subtotal()),
    discount: money(estimate.discountAmount()),
    tax: money(estimate.taxAmount()),
    total: money(estimate.total()),
    depositDue: money(estimate.depositDue()),
    depositPaid: money(p.depPaid),
    validDays: p.validDays,
    sentAt: p.sentAt?.toISOString() ?? null,
    followUpOn: p.followUpOn ?? false,
    followUpStage: p.followUpStage ?? 0,
    acceptedAt: p.acceptedAt?.toISOString() ?? null,
    declinedAt: p.declinedAt?.toISOString() ?? null,
    declineReason: p.declineReason,
    changeRequestedAt: p.changeRequestedAt?.toISOString() ?? null,
    changeRequest: p.changeRequest ?? null,
    jobId: p.jobId,
    recommendedTier: p.recommendedTier,
    acceptedTier: p.acceptedTier,
    tierNames: p.tierNames,
    termsSnapshot: p.termsSnapshot,
    publicToken: p.publicToken ?? null,
    publicUrl: publicUrlFor(p.publicToken ?? null),
    signature: toSignatureDTO(estimate),
    createdAt: p.createdAt.toISOString(),
  };
};

/**
 * The signature evidence, or null when the quote was accepted without one.
 *
 * Gated on signedAt AND the snapshot together. Either alone would be a half-record: a timestamp
 * with no document says nothing about what was agreed, and a snapshot with no timestamp cannot be
 * placed in time. The domain writes all of it in one transition, so a row with only one of them is
 * corruption — and rendering it as a signature would put a confident-looking but empty block in
 * front of a shop about to chase money.
 *
 * Totals come from the SNAPSHOT, never from the live estimate. That is the whole point: the live
 * row can be edited afterwards, and the frozen copy is what the customer actually saw.
 */
const toSignatureDTO = (estimate: Estimate) => {
  const p = estimate.props;
  const snap = p.signedSnapshot;
  if (!p.signedAt || !snap || !p.signerName) return null;
  return {
    signerName: p.signerName,
    // Empty string means they signed by typing their name — a real signature under Texas law, and
    // a different thing from a drawing that failed to save. Normalised to null so the UI branches
    // on presence rather than on truthiness of a string.
    signatureSvg: p.signatureSvg && p.signatureSvg.length > 0 ? p.signatureSvg : null,
    signerIp: p.signerIp ?? null,
    signerUserAgent: p.signerUserAgent ?? null,
    signedAt: p.signedAt.toISOString(),
    snapshot: {
      estimateNum: snap.estimateNum,
      totalCents: snap.totalCents,
      depositCents: snap.depositCents,
      chosenTier: snap.chosenTier,
      authorizationText: snap.authorizationText,
      lines: snap.lines.map((l) => ({
        description: l.description,
        quantity: l.quantity,
        rateCents: l.rateCents,
      })),
    },
  };
};

/**
 * The customer-facing link for a quote, or null when the origin cannot be resolved.
 *
 * Composed from the CANONICAL configured origin — never from the request or the sender's browser,
 * which vary per deployment URL, branch alias, custom domain and localhost. See
 * resolvePublicAppOrigin for the resolution order and why VERCEL_URL is excluded.
 *
 * Memoized: a list response maps this over every estimate, and loadConfig re-parses the whole
 * schema on each call. The origin is process-level configuration and cannot change mid-process.
 */
// `undefined` means "not resolved yet"; a resolved `null` (no origin configured) is cached too, so
// an unconfigured deployment does not re-parse the config for every row.
let cachedOrigin: string | null | undefined;
const publicUrlFor = (token: string | null): string | null => {
  if (!token) return null;
  if (cachedOrigin === undefined) cachedOrigin = resolvePublicAppOrigin(loadConfig());
  if (cachedOrigin === null) return null;
  return `${cachedOrigin}/q/${token}`;
};

const toSummaryDTO = (estimate: Estimate, customerName: string | null = null) => {
  const p = estimate.props;
  return {
    id: p.id,
    num: p.num,
    leadId: p.leadId,
    customerName,
    title: p.title,
    status: p.status,
    total: money(estimate.total()),
    createdAt: p.createdAt.toISOString(),
    publicToken: p.publicToken ?? null,
    publicUrl: publicUrlFor(p.publicToken ?? null),
    changeRequestedAt: p.changeRequestedAt?.toISOString() ?? null,
    recommendedTier: p.recommendedTier,
    acceptedTier: p.acceptedTier,
    tierNames: p.tierNames,
    termsSnapshot: p.termsSnapshot,
    // Same three-part gate as toSignatureDTO, so a row can never be flagged signed on the list
    // and then render no signature when the record opens.
    signed: Boolean(p.signedAt && p.signedSnapshot && p.signerName),
    followUpOn: p.followUpOn ?? false,
    followUpStage: p.followUpStage ?? 0,
  };
};

/**
 * A quote may only claim a scope-visit job the org actually owns, and only while that job is
 * still a walkthrough. The job id is CLIENT input: the org-scoped read (explicit eq(orgId) + RLS
 * on the tenant tx) refuses another tenant's id, and the kind gate refuses linking a quote to
 * sold work — convert-at-accept must never grab a job that is already someone's work order.
 * Refused loudly, not stored quietly.
 */
const assertScopeVisitJob = async (
  tx: TenantTx,
  orgId: OrgId,
  jobId: string,
): Promise<void> => {
  const job = await new DrizzleJobRepository(tx, orgId).findById(asJobId(jobId));
  if (!job) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "job not found for this quote" });
  }
  if (job.props.kind !== "estimate") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "a quote can only be linked to an estimate visit, not existing work",
    });
  }
};

// Layer 5: thin transport. Build the org-scoped use-case from the request's tx + ports, delegate,
// map the result. No business logic here.
export const createEstimateRouter = () =>
  router({
    // The estimator's learned-rule surface (v1.quoting.rules.*).
    rules: createQuotingRulesRouter(),

    draft: ownerOrOffice
      .input(draftInput)
      .output(estimateDTO)
      .mutation(async ({ ctx, input }) => {
        // Boundary guard on client input — see assertScopeVisitJob.
        if (input.jobId) await assertScopeVisitJob(ctx.tx, ctx.principal.orgId, input.jobId);
        const repo = new DrizzleEstimateRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new DraftEstimateUseCase(repo, ctx.deps.bus, ctx.deps.clock, ctx.deps.ids);
        const result = await useCase.exec({
          orgId: ctx.principal.orgId,
          leadId: asLeadId(input.leadId),
          title: input.title ?? null,
          discBps: input.discBps ?? 0,
          taxBps: input.taxBps ?? 0,
          depBps: input.depBps ?? 0,
          validDays: input.validDays ?? null,
          lines: input.lines.map((line) => ({
            description: line.description,
            quantity: line.quantity,
            rateCents: line.rateCents,
            costCents: line.costCents ?? 0,
            isOptional: line.isOptional ?? false,
            needsPhoto: line.needsPhoto ?? false,
            taxable: line.taxable ?? true,
            tier: line.tier ?? null,
            materialId: line.materialId ?? null,
          })),
          recommendedTier: input.recommendedTier ?? null,
          tierNames: input.tierNames ?? null,
          termsSnapshot: input.termsSnapshot ?? null,
          changeOrderForJobId: input.changeOrderForJobId ?? null,
          jobId: input.jobId ?? null,
          aiDraftLines:
            input.aiDraft?.lines.map((line) => ({
              description: line.description,
              quantity: line.quantity,
              rateCents: line.rateCents,
              tier: line.tier ?? null,
            })) ?? null,
        });
        return toEstimateDTO(orThrow(result));
      }),

    get: ownerOrOffice
      .input(idInput)
      .output(estimateDTO)
      .query(async ({ ctx, input }) => {
        const repo = new DrizzleEstimateRepository(ctx.tx, ctx.principal.orgId);
        const estimate = await repo.findById(asEstimateId(input.estimateId));
        if (!estimate) throw new TRPCError({ code: "NOT_FOUND", message: "estimate not found" });
        return toEstimateDTO(estimate);
      }),

    list: ownerOrOffice
      .input(listInput)
      .output(paginatedSummaryDTO)
      .query(async ({ ctx, input }) => {
        const repo = new DrizzleEstimateRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new ListEstimatesUseCase(repo);
        const page = await useCase.exec({
          page: toPage({ limit: input.limit, cursor: input.cursor ?? null }),
          filter: { status: input.status },
          sort: input.sort,
          sortDir: input.sortDir,
        });
        // ONE batched lead read for the page — never per row. Same pattern as the jobs and
        // invoices lists, and for the same reason: the browser's customer collection is capped, so
        // it cannot be relied on to hold these.
        const names = await new DrizzleLeadRepository(ctx.tx, ctx.principal.orgId).findByIds([
          ...new Set(page.items.map((e) => e.props.leadId)),
        ]);
        const nameById = new Map<string, string>(
          names.map((l: { props: { id: string; name: string } }) => [String(l.props.id), l.props.name]),
        );
        return {
          items: page.items.map((e) => toSummaryDTO(e, nameById.get(String(e.props.leadId)) ?? null)),
          nextCursor: page.nextCursor,
        };
      }),

    /**
     * The follow-up worklist: quotes the customer OPENED and has not answered.
     *
     * Its own endpoint rather than a flag on list(), because it answers a different question and
     * carries a different shape — it needs the customer's name and when the quote was opened, and
     * it is a worklist rather than a page of a book.
     */
    followUps: ownerOrOffice
      .input(z.object({ limit: z.number().int().positive().max(200).optional() }))
      .output(
        z.array(
          z.object({
            id: z.string().uuid(),
            num: z.string(),
            leadId: z.string().uuid(),
            customerName: z.string().nullable(),
            /** The customer's phone — the queue drafts a TEXT to this person. */
            customerPhone: z.string().nullable(),
            title: z.string().nullable(),
            total: moneyDTO,
            sentAt: z.string().nullable(),
            firstViewedAt: z.string().nullable(),
          }),
        ),
      )
      .query(async ({ ctx, input }) => {
        const repo = new DrizzleEstimateRepository(ctx.tx, ctx.principal.orgId);
        const rows = await repo.viewedAwaitingReply(input.limit ?? 50);
        return rows.map((r) => ({
          id: r.id,
          num: r.num,
          leadId: r.leadId,
          customerName: r.customerName,
          customerPhone: r.customerPhone,
          title: r.title,
          total: { cents: r.totalCents, currency: "USD" as const },
          sentAt: r.sentAt?.toISOString() ?? null,
          firstViewedAt: r.firstViewedAt?.toISOString() ?? null,
        }));
      }),

    listByLead: ownerOrOffice
      .input(listByLeadInput)
      .output(paginatedSummaryDTO)
      .query(async ({ ctx, input }) => {
        const repo = new DrizzleEstimateRepository(ctx.tx, ctx.principal.orgId);
        const page = await repo.listByLead(
          asLeadId(input.leadId),
          toPage({ limit: input.limit, cursor: input.cursor ?? null }),
        );
        // One lookup for the one lead these all belong to, so customerName is never null here
        // just because this endpoint took a different route to the same rows.
        const [lead] = await new DrizzleLeadRepository(ctx.tx, ctx.principal.orgId).findByIds([
          asLeadId(input.leadId),
        ]);
        const name = lead?.props.name ?? null;
        return {
          items: page.items.map((e) => toSummaryDTO(e, name)),
          nextCursor: page.nextCursor,
        };
      }),

    // "Build the price": turn a job's measurements — scanned rooms AND traced site surfaces —
    // into estimate seed lines the composer can drop straight into a draft. Read-only (no
    // estimate is created here) — the composer decides what to keep before calling v1.quoting.draft.
    buildFromMeasurements: ownerOrOffice
      .input(buildFromMeasurementsInput)
      .output(buildFromMeasurementsOutput)
      .query(async ({ ctx, input }) => {
        const jobId = asJobId(input.jobId);
        const measurements = new DrizzleMeasurementRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new BuildFromMeasurementsUseCase(
          new DrizzleJobLeadReader(ctx.tx, ctx.principal.orgId),
          new MeasurementRoomQuantitiesReader(measurements),
          new MeasurementSiteQuantitiesReader(measurements),
          new DrizzleRateServicesReader(ctx.tx, ctx.principal.orgId),
        );
        const built = orThrow(
          await useCase.exec({ jobId, ...(input.sourceNames ? { sourceNames: input.sourceNames } : {}) }),
        );
        return {
          leadId: built.leadId,
          seedLines: built.seedLines.map((line) => ({ ...line })),
          gaps: built.gaps.map((gap) => ({ ...gap })),
          unconfirmedRooms: [...built.unconfirmedRooms],
        };
      }),

    send: ownerOrOffice
      .input(idInput)
      .output(estimateDTO)
      .mutation(async ({ ctx, input }) => {
        const estimateId = asEstimateId(input.estimateId);
        const repo = new DrizzleEstimateRepository(ctx.tx, ctx.principal.orgId);
        // send() is idempotent — note whether THIS call performs the real draft→sent
        // transition, so edit-delta mining runs once per estimate (a re-send must not
        // double-count "recurrences" of the same correction).
        const before = await repo.findById(estimateId);
        const wasDraft = before?.props.status === "draft";
        const useCase = new SendEstimateUseCase(repo, ctx.deps.bus, ctx.deps.clock);
        const sent = orThrow(await useCase.exec({ estimateId }));

        // Edit-delta mining (AI-originated estimates only): diff the ai_draft snapshot
        // against the lines actually sent; material deltas land as PROPOSED quoting_rules.
        // Wrapped in a savepoint, mirroring the accept-path job creation — a mining
        // failure logs and rolls back its own writes, and NEVER blocks the send.
        if (wasDraft) {
          await runInSavepoint(
            ctx.tx,
            async (sp) => {
              const spEstimates = new DrizzleEstimateRepository(sp, ctx.principal.orgId);
              const snapshot = await spEstimates.getAiDraft(estimateId);
              if (!snapshot) return null; // hand-built estimate — nothing to mine
              const miner = new MineEditDeltasUseCase(
                new DrizzleQuotingRuleRepository(sp, ctx.principal.orgId),
                new DrizzleServiceNameReader(sp, ctx.principal.orgId),
                ctx.deps.clock,
                ctx.deps.ids,
              );
              const mined = await miner.exec({
                orgId: ctx.principal.orgId,
                estimateId,
                snapshot,
                sentLines: sent.props.lines.map((line) => ({
                  description: line.props.description,
                  quantity: line.props.quantity,
                  rateCents: line.props.rate,
                  isOptional: line.props.isOptional,
                  tier: line.props.tier,
                })),
              });
              if (!mined.ok) {
                logger.error(
                  { err: mined.error, estimateId, orgId: ctx.principal.orgId },
                  "quoting.send: edit-delta mining returned error (non-fatal)",
                );
              }
              return null;
            },
            (err) => {
              logger.error(
                { err, estimateId, orgId: ctx.principal.orgId },
                "quoting.send: edit-delta mining failed (non-fatal)",
              );
            },
          );
        }

        return toEstimateDTO(sent);
      }),

    accept: ownerOrOffice
      .input(acceptInput)
      .output(estimateDTO.extend({ job: jobSummaryDTO.nullable() }))
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleEstimateRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new AcceptEstimateUseCase(repo, ctx.deps.bus, ctx.deps.clock, ctx.deps.ids);
        const accepted = orThrow(
          await useCase.exec({
            estimateId: asEstimateId(input.estimateId),
            lines: input.lines?.map((line) => ({
              description: line.description,
              quantity: line.quantity,
              rateCents: line.rateCents,
              costCents: line.costCents ?? 0,
              isOptional: line.isOptional ?? false,
              needsPhoto: line.needsPhoto ?? false,
              taxable: line.taxable ?? true,
            })),
            chosenTier: input.chosenTier,
          }),
        );

        // After the estimate is accepted, create its job atomically in the same tx.
        // Wrapped in a savepoint so a job-creation failure does NOT roll back the accepted estimate.
        // CreateJobFromEstimateUseCase is idempotent (partial unique index on source_estimate_id +
        // ON CONFLICT DO NOTHING), so a re-accept is safe. If job creation fails, do NOT fail the
        // accept — log and continue. The manual v1.jobs.createFromEstimate endpoint is the fallback.
        // The created (or existing) job is returned so the client can adopt it into the jobs store
        // immediately without a network round-trip. runInSavepoint guarantees a
        // savepoint failure yields null even when the use-case had already produced a summary —
        // the insert rolled back, and a non-null return would leak a phantom job to the client.
        const jobSummary = await runInSavepoint(
          ctx.tx,
          async (sp) => {
            const jobRepo = new DrizzleJobRepository(sp, ctx.principal.orgId);
            const estimateReader = new DrizzleEstimateReader(sp, ctx.principal.orgId);
            const createJob = new CreateJobFromEstimateUseCase(
              jobRepo,
              estimateReader,
              ctx.deps.bus,
              ctx.deps.clock,
              ctx.deps.ids,
            );
            const result = await createJob.exec({ orgId: ctx.principal.orgId, estimateId: asEstimateId(input.estimateId) });
            if (!result.ok) {
              logger.error(
                { err: result.error, estimateId: input.estimateId, orgId: ctx.principal.orgId },
                "quoting.accept: job creation returned error (non-fatal)",
              );
              return null;
            }
            return toJobSummaryDTO(result.value);
          },
          (err) => {
            logger.error(
              { err, estimateId: input.estimateId, orgId: ctx.principal.orgId },
              "quoting.accept: job creation failed (non-fatal)",
            );
          },
        );

        return { ...toEstimateDTO(accepted), job: jobSummary };
      }),

    archive: ownerOrOffice
      .input(idInput)
      .output(z.object({ ok: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleEstimateRepository(ctx.tx, ctx.principal.orgId);
        const count = await repo.archive(asEstimateId(input.estimateId), ctx.deps.clock.now());
        if (count === 0) {
          throw new TRPCError({ code: "NOT_FOUND", message: "estimate not found or already archived" });
        }
        return { ok: true };
      }),

    restore: ownerOrOffice
      .input(idInput)
      .output(estimateDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleEstimateRepository(ctx.tx, ctx.principal.orgId);
        const now = ctx.deps.clock.now();
        const restored = await repo.restore(asEstimateId(input.estimateId), now);
        if (restored) return toEstimateDTO(restored);
        // Already active — fall back to a fresh load so the caller always gets the current DTO.
        const existing = await repo.findById(asEstimateId(input.estimateId));
        if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "estimate not found" });
        return toEstimateDTO(existing);
      }),

    /** Chasing this quote: on/off plus how many nudges have gone out. Was client-local, so the
     *  toggle read back OFF after a refetch whatever the user had set. */
    setFollowUp: ownerOrOffice
      .input(z.object({
        estimateId: z.string().uuid(),
        on: z.boolean(),
        stage: z.number().int().min(0).max(10),
      }))
      .output(z.object({ ok: z.literal(true) }))
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleEstimateRepository(ctx.tx, ctx.principal.orgId);
        const estimate = await repo.findById(asEstimateId(input.estimateId));
        if (!estimate) throw new TRPCError({ code: "NOT_FOUND", message: "quote not found" });
        const next = estimate.setFollowUp(input.on, input.stage, ctx.deps.clock.now());
        if (!next.ok) throw new TRPCError({ code: "BAD_REQUEST", message: next.error.message });
        await repo.save(next.value);
        return { ok: true as const };
      }),

    decline: ownerOrOffice
      .input(declineInput)
      .output(estimateDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleEstimateRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new DeclineEstimateUseCase(repo, ctx.deps.bus, ctx.deps.clock);
        return toEstimateDTO(
          orThrow(await useCase.exec({ estimateId: asEstimateId(input.estimateId), reason: input.reason })),
        );
      }),

    clearChangeRequest: ownerOrOffice
      .input(idInput)
      .output(estimateDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleEstimateRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new ClearEstimateChangeRequestUseCase(repo, ctx.deps.bus, ctx.deps.clock);
        return toEstimateDTO(orThrow(await useCase.exec({ estimateId: asEstimateId(input.estimateId) })));
      }),
  });
