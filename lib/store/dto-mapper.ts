/**
 * lib/store/dto-mapper.ts
 * Shared DTO → store type mappers. Extracted from features/jobs/jobs-hydrator.tsx
 * so jobs-slice can call them in reconcile callbacks after mutations resolve,
 * without importing the React hydrator component.
 *
 * Also exports dtoEstimateToStore and dtoInvoiceToStore — the canonical mappers
 * for estimate/invoice DTOs returned by mutation endpoints. Both the hydrators
 * (estimates-hydrator, invoices-hydrator) and the slice reconcile paths MUST use
 * these functions so money-unit conversions (cents ↔ dollars) stay in one place.
 *
 * Money unit rules (enforced here and nowhere else):
 *   Store → Backend: dollars × 100, round to int → cents
 *   Backend → Store: DTO.cents / 100 → dollars
 *
 * Only pure mapping logic lives here — no React, no tRPC, no side effects.
 */

import type { RouterOutputs } from "@/lib/trpc/client";
import { daysSince } from "@/lib/clock";
import { isVisitPlaced, recalcJobPlacement } from "./visit-placement";
import { shortWhen } from "@/lib/format";
import type {
  Addon,
  Estimate,
  Invoice,
  Job,
  JobLine,
  LeadNote,
  PurchaseOrder,
  PurchaseOrderNote,
  TimeEntry,
  Visit,
  JobFile,
} from "./types";
import { JOB_ORIGIN } from "./hydrator-config";

export type JobDTO = RouterOutputs["v1"]["visits"]["createVisit"];
export type EstimateDTO = RouterOutputs["v1"]["quoting"]["draft"];
export type InvoiceDTO = RouterOutputs["v1"]["invoicing"]["draft"];

/**
 * The invoice as it crosses to a TECHNICIAN's device — a separate, smaller shape, never a
 * filtered copy of `InvoiceDTO` (see modules/invoicing/api/field-invoice-dto.ts).
 *
 * It always carries the money a person at the door must be able to read (total, balance, the
 * payments already taken); it carries NO line `cost` at all, no `publicToken`/`publicUrl`, no
 * signed-amount `authorization`, no follow-up policy. Line `rate` is null when the shop hides
 * prices from techs.
 */
export type FieldInvoiceDTO = RouterOutputs["v1"]["fieldInvoicing"]["get"];

/**
 * The LIST shapes — deliberately separate types, because they are deliberately smaller.
 *
 * A summary carries what a row needs; the full DTO carries lines, payments and tax. Passing a
 * summary to the full mapper reads fields that are not there and throws, which is exactly how the
 * Money and Pipeline pages came to render "Something went wrong": both call sites had an
 * `as never` cast that silenced the compiler's objection. Naming these types is what makes that
 * mistake impossible rather than merely discouraged.
 */
export type InvoiceSummaryDTO = RouterOutputs["v1"]["invoicing"]["list"]["items"][number];
export type EstimateSummaryDTO = RouterOutputs["v1"]["quoting"]["list"]["items"][number];
export type TimeEntryDTO = RouterOutputs["v1"]["timesheets"]["list"]["items"][number];
type VisitDTO = JobDTO["visits"][number];

/** The card-on-file facts as every server DTO carries them (customers.list, field.myDay). */
export interface CardOnFileDTO {
  brand: string;
  last4: string;
  via: "payment" | "deposit";
}

// Stripe reports networks lowercase ("visa", "amex"); the button says "Charge Visa ···· 4242".
const CARD_BRAND_LABEL: Record<string, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "Amex",
  discover: "Discover",
  diners: "Diners",
  jcb: "JCB",
  unionpay: "UnionPay",
};

/**
 * The wire card → the store lead's `card`. `via` becomes the display phrase here (the close-out
 * prints it verbatim inside "saved from … · instant, no tap"), the same convention as every
 * other display string this file mints — machine values stay on the wire, words live in one place.
 */
export function dtoCardToStore(dto: CardOnFileDTO): { brand: string; last4: string; via: string } {
  return {
    brand: CARD_BRAND_LABEL[dto.brand] ?? (dto.brand.charAt(0).toUpperCase() + dto.brand.slice(1)),
    last4: dto.last4,
    via: dto.via === "deposit" ? "the deposit" : "an earlier payment",
  };
}

export type LeadNoteDTO = RouterOutputs["v1"]["customers"]["listNotes"]["items"][number];

/**
 * A persisted activity entry → the store's LeadNote shape, so the note feed renders a server row
 * and a just-typed optimistic one identically. `when` becomes a display string here (the feed
 * shows it verbatim); the ISO stamp is what the server ordered by, and is not needed again.
 *
 * The attachment collapses three nullable columns into one optional object, and only when ALL
 * THREE are present. The row's CHECK already guarantees they move together, but a mapper that
 * trusted the path alone would mint an `att` with an empty name the moment that guarantee
 * changed, and the feed would render a nameless button nobody can identify.
 */
export function dtoLeadNoteToStore(dto: LeadNoteDTO): LeadNote {
  return {
    id: dto.id,
    type: dto.kind,
    when: shortWhen(dto.createdAt),
    t: dto.body,
    ...(dto.author ? { from: dto.author } : {}),
    ...(dto.direction ? { dir: dto.direction } : {}),
    ...(dto.outcome ? { outcome: dto.outcome } : {}),
    ...(dto.durationLabel ? { dur: dto.durationLabel } : {}),
    ...(dto.via ? { via: dto.via } : {}),
    ...(dto.overnight ? { overnight: true } : {}),
    ...(dto.attachmentPath && dto.attachmentType && dto.attachmentName
      ? { att: { path: dto.attachmentPath, type: dto.attachmentType, name: dto.attachmentName } }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// Time helpers (duplicated in jobs-hydrator; exported from here for slices)
// ---------------------------------------------------------------------------

/**
 * Parse "HH:MM" → fractional hour.  "09:30" → 9.5, null/bad → 0.
 */
export function hhmmToHour(hhmm: string | null | undefined): number {
  if (!hhmm) return 0;
  const parts = hhmm.split(":").map(Number);
  const hh = parts[0];
  const mm = parts[1];
  if (hh === undefined || mm === undefined || !Number.isFinite(hh) || !Number.isFinite(mm)) return 0;
  return hh + mm / 60;
}

/** Fractional hour → "HH:MM".  9.5 → "09:30", 14 → "14:00". */
export function hourToHHMM(h: number): string {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/**
 * Derive duration (hours) from scheduledStart / scheduledEnd strings.
 * Falls back to defaultDur when either is absent or end ≤ start.
 */
export function hoursBetween(
  start: string | null | undefined,
  end: string | null | undefined,
  defaultDur = 2,
): number {
  if (start == null || start === "" || end == null || end === "") return defaultDur;
  const s = hhmmToHour(start);
  const e = hhmmToHour(end);
  const diff = e - s;
  return diff > 0 ? diff : defaultDur;
}

// ---------------------------------------------------------------------------
// Status mappings
// ---------------------------------------------------------------------------

const BACKEND_VISIT_STATUS = {
  PENDING: "pending",
  IN_PROGRESS: "in_progress",
  COMPLETE: "complete",
  CANCELED: "canceled",
} as const;

const BACKEND_JOB_STATUS = {
  SCHEDULED: "scheduled",
  IN_PROGRESS: "in_progress",
  COMPLETE: "complete",
  CANCELED: "canceled",
} as const;

/**
 * The words the store and the UI use for a visit. Only three of them are backend statuses:
 * ENROUTE is DERIVED from the enroute_at stamp on a still-pending visit — the backend has no
 * fifth status value (see JobVisitProps.enrouteAt).
 */
export const STORE_VISIT_STATUS = {
  SCHEDULED: "scheduled",
  ENROUTE: "enroute",
  ONSITE: "onsite",
  DONE: "done",
} as const;

/**
 * Store visit status → backend VisitStatus enum value.
 *
 * "enroute" maps to pending because that IS the status of a visit being travelled to — but
 * calling setVisitStatus with it writes nothing (the visit is already pending and the server
 * short-circuits it as idempotent). The stamp is written by v1.visits.setVisitEnroute instead;
 * the store's setVisitStatus routes there.
 */
export function storeStatusToBackend(
  storeStatus: string,
): "pending" | "in_progress" | "complete" | "canceled" {
  if (storeStatus === STORE_VISIT_STATUS.ONSITE) return "in_progress";
  if (storeStatus === STORE_VISIT_STATUS.DONE) return "complete";
  // "scheduled", "enroute" and anything unknown → pending
  return "pending";
}

/**
 * Backend status + the enroute stamp → the store's word. A pending visit carrying a stamp is
 * "enroute"; without one it is "scheduled". Reading the stamp here is what makes On my way
 * survive a reload — the store holds no state the DTO cannot rebuild.
 */
function toStoreVisitStatusInternal(s: string, enrouteAt: string | null | undefined): string {
  if (s === BACKEND_VISIT_STATUS.IN_PROGRESS) return STORE_VISIT_STATUS.ONSITE;
  if (s === BACKEND_VISIT_STATUS.COMPLETE) return STORE_VISIT_STATUS.DONE;
  if (s === BACKEND_VISIT_STATUS.PENDING && enrouteAt) return STORE_VISIT_STATUS.ENROUTE;
  return STORE_VISIT_STATUS.SCHEDULED;
}

function toStoreJobStatusInternal(s: string): string {
  if (s === BACKEND_JOB_STATUS.COMPLETE || s === BACKEND_JOB_STATUS.CANCELED) return "done";
  if (s === BACKEND_JOB_STATUS.SCHEDULED || s === BACKEND_JOB_STATUS.IN_PROGRESS) return "scheduled";
  return "unscheduled";
}

/** The one word the store uses for a job the backend has closed — both `complete` and
 *  `canceled` map to it. */
export const STORE_JOB_STATUS_DONE = "done";

/**
 * ONE rule with two entry points: **a terminal job's status always outranks the visit-placement
 * recalc.** Whether the job's visits ever reached the Schedule board says nothing about whether
 * the backend has closed it.
 *
 * Three places derive a job's status from its visits, and they must not disagree:
 *   - `dtoJobToStoreJob` below and `toStoreJob` in features/jobs/jobs-hydrator.tsx read a DTO,
 *     so they ask `isTerminalBackendJobStatus(dto.status)`;
 *   - the optimistic leg in lib/store/slices/jobs-slice.ts has no DTO — only the record already
 *     in the store — so it asks `isTerminalStoreJobStatus(job.status)`.
 * Two predicates because the two vocabularies differ (`complete`/`canceled` on the wire collapse
 * to `done` in the store), not two rules. Both callers short-circuit the WHOLE recalc.
 */
export function isTerminalBackendJobStatus(status: string): boolean {
  return status === BACKEND_JOB_STATUS.COMPLETE || status === BACKEND_JOB_STATUS.CANCELED;
}

/** The store-vocabulary half of the rule above. */
export function isTerminalStoreJobStatus(status: string): boolean {
  return status === STORE_JOB_STATUS_DONE;
}

// ---------------------------------------------------------------------------
// DTO → store mappers (public)
// ---------------------------------------------------------------------------

/** THE rule — see recalcJobPlacement. Kept as a local alias so the call sites below read the same. */
const recalcJobStatus = (visits: Visit[]): string => recalcJobPlacement(visits);

/**
 * Map a job DTO's checklist (nullable) to the store shape. The DTO carries no
 * per-item position (order = array order); synthesize it from the index so the
 * store's ChecklistItem shape stays satisfied.
 */
export function dtoChecklistToStore(
  cl: JobDTO["checklist"],
): Job["checklist"] {
  if (!cl) return undefined;
  return {
    name: cl.name,
    items: cl.items.map((it, i) => ({
      id: it.id,
      text: it.text,
      type: it.type,
      required: it.required,
      position: i,
    })),
  };
}

/** Map a single visitDTO to a store Visit. */
export function toStoreVisit(v: VisitDTO): Visit {
  return {
    id: v.id,
    techId: v.assigneeUserId ?? null,
    date: v.scheduledDate ?? null,
    start: v.scheduledStart ? hhmmToHour(v.scheduledStart) : null,
    // durationMinutes is the authoritative length (persists for unplaced visits
    // too); the start→end window is the fallback for legacy rows without it.
    dur:
      v.durationMinutes != null
        ? v.durationMinutes / 60
        : hoursBetween(v.scheduledStart, v.scheduledEnd),
    status: toStoreVisitStatusInternal(v.status, v.enrouteAt),
    // The step stamps, carried through verbatim — including their nulls, which mean "nobody
    // tapped it" and not "we don't know". The visit stepper prints these; see the Visit type.
    // `?? null` normalises an absent DTO field to the same absence the column has.
    enrouteAt: v.enrouteAt ?? null,
    startedAt: v.startedAt ?? null,
    completedAt: v.completedAt ?? null,
    ...(v.notes ? { scopeNotes: v.notes } : {}),
  };
}

// ---------------------------------------------------------------------------
// Execution data mapper (DRY: single conversion site used by both
// dtoJobToStoreJob and jobs-hydrator.tsx toStoreJob).
// ---------------------------------------------------------------------------

/**
 * Execution DTO shape — the four arrays shared by jobDTO and jobSummaryDTO.
 * All fields are optional so callers that don't have them yet (e.g. legacy
 * test fixtures cast with `as never`) still work without runtime errors.
 *
 * rate/cost are nullable: the tech-facing field surface redacts them
 * server-side (cost always for techs; rate when techSeesPrice is off).
 */
export interface ExecutionDTO {
  lines?: {
    description: string;
    quantity: number;
    rate: { cents: number } | null;
    cost: { cents: number } | null;
  }[];
  addons?: {
    id: string;
    description: string;
    quantity: number;
    rate: { cents: number } | null;
    cost: { cents: number } | null;
    isOptional: boolean;
    invoiceSkip: boolean;
    status: "proposed" | "approved" | "declined";
    position: number;
  }[];
  verifyAnswers?: {
    itemId: string;
    state: "pass" | "override";
    via: string | null;
    reason: string | null;
  }[];
  photos?: {
    id: string;
    storagePath: string;
    caption: string | null;
    // Optional on the wire: an older server does not send them, and null already means image.
    mimeType?: string | null;
    fileName?: string | null;
  }[];
}

/**
 * Map execution arrays from a DTO into the store Job shape.
 * Single conversion site for lines/addons/photos/verify — both
 * dtoJobToStoreJob and the jobs-hydrator toStoreJob call this.
 *
 * Money: DTO carries integer cents; store uses dollars (cents / 100).
 * A server-REDACTED rate (null — tech device, techSeesPrice off) stays null
 * in the store so the UI can tell "hidden" from "$0"; a redacted cost is
 * simply omitted (c is optional).
 * Addon.id is derived from the array index (stable numeric id for the
 * prototype UI); dbId carries the DB uuid for persistence.
 */
export function mapExecution(dto: ExecutionDTO): Pick<Job, "lines" | "addons" | "photos" | "files" | "verify"> {
  const lines: JobLine[] = (dto.lines ?? []).map((l) => ({
    d: l.description,
    q: l.quantity,
    r: l.rate ? l.rate.cents / 100 : null,
    ...(l.cost && l.cost.cents > 0 ? { c: l.cost.cents / 100 } : {}),
  }));

  const addons: Addon[] = (dto.addons ?? []).map((a, i) => ({
    id: i,
    dbId: a.id,
    d: a.description,
    q: a.quantity,
    r: a.rate ? a.rate.cents / 100 : null,
    ...(a.cost && a.cost.cents > 0 ? { c: a.cost.cents / 100 } : {}),
    status: a.status,
    ...(a.invoiceSkip ? { invSkip: true } : {}),
  }));

  // SPLIT ON MIME. Both live in job_photos server-side; the client needs them apart because a
  // thumbnail grid and a named link are different renders. A NULL mime is an image — every row
  // written before attachments existed was one, since the upload enum only admitted jpg/png/webp.
  const isImage = (m: string | null | undefined): boolean => !m || m.startsWith("image/");
  const photos: string[] = (dto.photos ?? [])
    .filter((p) => isImage(p.mimeType))
    .map((p) => p.storagePath);
  const files: JobFile[] = (dto.photos ?? [])
    .filter((p) => !isImage(p.mimeType))
    .map((p) => ({
      id: p.id,
      storagePath: p.storagePath,
      // A document with no name is unopenable in practice, so fall back to the key's tail.
      name: p.fileName ?? p.storagePath.split("/").pop() ?? "file",
      mimeType: p.mimeType ?? "application/octet-stream",
      caption: p.caption,
    }));

  const verifyAns: Record<string, { st: "pass" | "override"; via?: string; reason?: string }> = {};
  for (const v of dto.verifyAnswers ?? []) {
    verifyAns[v.itemId] = {
      st: v.state,
      ...(v.via ? { via: v.via } : {}),
      ...(v.reason ? { reason: v.reason } : {}),
    };
  }

  return { lines, addons, photos, files, verify: { ans: verifyAns } };
}

/**
 * Map a full jobDTO (returned by all v1.visits mutations) to a store Job.
 * Cancelled visits are filtered out — they are never shown on the board.
 *
 * The returned job carries `origin: "db"` so the slice can persist on
 * subsequent operations.
 */
export function dtoJobToStoreJob(dto: JobDTO): Job {
  const activeVisitDTOs = dto.visits.filter(
    (v) => v.status !== BACKEND_VISIT_STATUS.CANCELED,
  );
  const visits = activeVisitDTOs.map(toStoreVisit);
  const isTerminal = isTerminalBackendJobStatus(dto.status);
  // A terminal backend status (complete/canceled) ALWAYS wins over the visit-placement
  // recalc below. The backend already decided the job is done; whether its visit ever got
  // dragged onto the Schedule board is irrelevant to that fact. Without this, a job
  // completed straight from My Day — one visit, complete, never placed — would recalc from
  // placement state alone (recalcJobStatus sees no placed visits and returns "unscheduled"),
  // and a completed job with real revenue would vanish from Money's ready-to-bill list.
  // Otherwise: when there are active visits, recalc from their placement state. When there
  // are no active visits AND the backend status is "scheduled", remap to "unscheduled" — a
  // zero-visit job has not been slotted yet (this is the common state immediately after a
  // quote is accepted and CreateJobFromEstimateUseCase runs). "in_progress" is preserved
  // as-is via the fallback.
  const status = isTerminal
    ? toStoreJobStatusInternal(dto.status)
    : visits.length > 0
      ? recalcJobStatus(visits)
      : dto.status === BACKEND_JOB_STATUS.SCHEDULED
        ? "unscheduled"
        : toStoreJobStatusInternal(dto.status);

  return {
    id: dto.id,
    leadId: dto.leadId,
    sourceEstimateId: dto.sourceEstimateId ?? null,
    // Signature rides the FULL job DTO only; the summary omits it, so a list-hydrated job
    // correctly has none until the record is opened.
    signature: "signature" in dto ? (dto.signature ?? undefined) : undefined,
    svc: dto.svc ?? "service",
    kind: dto.kind,
    origin: JOB_ORIGIN.DB,
    title: dto.title ?? "Job",
    // `cust` is DELIBERATELY absent here. The full jobDTO carries no customerName — only
    // jobSummaryDTO (the list read) does, and giving 19 toJobDTO call sites a lead lookup to
    // populate a field only the list renders is the wrong trade. mergeIncomingJob carries the
    // hydrated name forward instead, the same way withExecution carries lines forward.
    addr: dto.addr ?? "",
    phone: dto.phone ?? "",
    status,
    archived: false,
    // basis points → percent (1000 bps = 10%), same convention as Estimate.pricing.
    // Omitted when both rates are zero — the common job carries no rates at all.
    ...(dto.discBps > 0 || dto.taxBps > 0
      ? { pricing: { disc: dto.discBps / 100, tax: dto.taxBps / 100 } }
      : {}),
    notes: dto.notes ?? "",
    completion: dto.completion ?? undefined,
    invRequested: dto.invRequested,
    // Explicitly set (undefined when the DTO carries null) so a reconcile after a
    // detach actually REMOVES the checklist from the store record.
    checklist: dtoChecklistToStore(dto.checklist),
    requiredCerts: dto.requiredCerts ?? null,
    acts: [],
    visits,
    ...mapExecution(dto),
  };
}

// ---------------------------------------------------------------------------
// Estimate DTO → store (mutation reconcile path)
// ---------------------------------------------------------------------------

/**
 * Map a full estimateDTO (returned by draft/send/accept/decline mutations) to a
 * store Estimate.
 *
 * Money: DTO carries integer cents; store uses dollars.
 *   rate.cents / 100  → EstimateLine.r  (dollars)
 *   cost.cents / 100  → EstimateLine.c  (dollars, omitted when 0)
 *   discBps / 100     → pricing.disc    (percent, e.g. 10 for 10%)
 *   taxBps  / 100     → pricing.tax
 *   depBps  / 100     → pricing.dep
 *   total.cents / 100 → cachedTotal     (dollars)
 *   depositPaid.cents / 100 → depPaid   (dollars — collected, not the ask)
 *
 * @param dto - Full estimateDTO from the quoting router.
 * @param priorFu - Preserve the existing client-local follow-up state (fu is not persisted).
 */
export function dtoEstimateToStore(dto: EstimateDTO, priorFu: Estimate["fu"]): Estimate {
  return {
    id: dto.id,
    num: dto.num,
    leadId: dto.leadId,
    title: dto.title ?? "Quote",
    status: dto.status,
    age: 0,
    // viewed: anything past draft was at minimum sent — customer has seen it.
    viewed: dto.status !== "draft",
    validDays: dto.validDays ?? undefined,
    // fu comes from the server now. priorFu is the fallback for an in-flight optimistic toggle
    // the response has not caught up with.
    fu: dto.followUpOn !== undefined
      ? { on: dto.followUpOn, stage: dto.followUpStage }
      : priorFu,
    // The DTO names a component's parent by id; the store holds an INDEX, because the composer
    // edits lines that have no server id yet. Resolve here, the one boundary that has both.
    lines: dto.lines.map((l, _i, all) => ({
      d: l.description,
      q: l.quantity,
      r: l.rate.cents / 100,                                  // cents → dollars
      c: l.cost.cents > 0 ? l.cost.cents / 100 : undefined,  // omit when zero-cost
      opt: l.isOptional || undefined,
      photo: l.needsPhoto || undefined,
      // Only the EXCEPTION is written — an ordinary taxable line carries no key at all.
      ...(l.taxable ? {} : { notax: true as const }),
      tier: l.tier ?? undefined,                              // GBB tier tag (null → absent)
      scope: l.scope ?? undefined,                            // proposal prose (null → absent)
      sub: l.subItems?.map((si) => ({
        d: si.description,
        q: si.quantity,
        unit: si.unit ?? undefined,
        amt: si.amountCents / 100,                            // cents → dollars
      })),
      unit: l.unit ?? undefined,
      qtyExpr: l.qtyExpr ?? undefined,
      roundUp: l.roundUp || undefined,
      parentIndex: l.parentLineId
        ? (() => {
            const at = all.findIndex((candidate) => candidate.id === l.parentLineId);
            return at >= 0 ? at : undefined;
          })()
        : undefined,
      // Only the EXCEPTION is written, like notax: an ordinary line carries no key.
      ...(l.customerVisible ? {} : { hidden: true as const }),
      markupBps: l.markupBps ?? undefined,
      sectionIndex: l.sectionId
        ? (() => {
            const at = dto.sections.findIndex((section) => section.id === l.sectionId);
            return at >= 0 ? at : undefined;
          })()
        : undefined,
    })),
    // Already in render order from the domain — the store keeps names only, since a line names
    // its section by position the same way a component names its parent.
    sections: dto.sections.map((section) => section.name),
    pricing: {
      disc: dto.discBps / 100,   // basis points → percent (1000 bps = 10%)
      tax: dto.taxBps / 100,
      dep: dto.depBps / 100,
    },
    cachedTotal: dto.total.cents / 100,   // cents → dollars
    depPaid: dto.depositPaid.cents / 100, // cents → dollars (what was COLLECTED, not the ask)
    publicToken: dto.publicToken ?? undefined,  // null → undefined (absent when not yet set)
    publicUrl: dto.publicUrl ?? undefined,
    changeRequestedAt: dto.changeRequestedAt ?? undefined,
    changeRequest: dto.changeRequest ?? undefined,
    // The scope-visit job this quote prices — accept converts it (see Estimate.jobId).
    jobId: dto.jobId ?? undefined,
    // Good/Better/Best — tier fields ride the DTO as-is (no money units involved;
    // the DTO's total above already derives from the recommended/accepted tier).
    recommendedTier: dto.recommendedTier ?? undefined,
    acceptedTier: dto.acceptedTier ?? undefined,
    tierNames: dto.tierNames ?? undefined,
    termsSnapshot: dto.termsSnapshot ?? undefined,
    // Only the EXCEPTION is written — 'lines' (the default) carries no key at all.
    ...(dto.priceDisplay === "total" ? { priceDisplay: "total" as const } : {}),
    // The frozen presentation rides the DTO as-is (no money units involved; absent when null).
    ...(dto.presentationSnapshot ? { presentation: dto.presentationSnapshot } : {}),
    // Signature: carried through UNCONVERTED, cents and all. Every other money field on this
    // mapper becomes dollars, and this one deliberately does not — the snapshot is a frozen record
    // of what somebody signed, and a number this app divided by 100 is no longer the number on the
    // document. See the note on Estimate.signature.
    signature: dto.signature ?? undefined,
    // Derived, never independently sourced — the flag and the evidence cannot disagree.
    signed: Boolean(dto.signature),
    reads: [],                             // client-local — not persisted
    archived: false,
    trash: false,
  };
}

// ---------------------------------------------------------------------------
// Invoice DTO → store (mutation reconcile path)
// ---------------------------------------------------------------------------

/**
 * Map a full invoiceDTO (returned by draft/send/recordPayment/void mutations) to a
 * store Invoice.
 *
 * Money: DTO carries integer cents; store uses dollars.
 *   total.cents / 100       → Invoice.total   (dollars)
 *   depositPaid.cents / 100 → Invoice.depPaid (dollars)
 *   payment.amount.cents / 100 → Payment.amt  (dollars)
 *   line.rate.cents / 100   → InvoiceLine.r   (dollars)
 *   line.cost.cents / 100   → InvoiceLine.c   (dollars, omitted when 0)
 *
 * Client-local fields (cust, phone, email) are not in the DTO; preserve them
 * from the prior store record passed as `priorInv`.
 *
 * @param dto - Full invoiceDTO from the invoicing router.
 * @param priorInv - Prior store record (used to preserve local-only fields).
 */
/**
 * A LIST row → a store Invoice. Header only, and honest about it.
 *
 * The ledger renders one row per invoice: who, what, how much, how much is left. It does not need
 * the lines or the payment history, and the list endpoint does not send them — so this builds a
 * record with those empty rather than pretending, and the modal fetches the full invoice when the
 * row is opened.
 *
 * `paidTotal` is why the money still adds up. Balance normally comes from summing the payments,
 * which are absent here; the server already computed `due`, so the paid figure is derived from it
 * and marked authoritative. Without that, every row on the ledger would read as fully unpaid.
 */
export function dtoInvoiceSummaryToStore(
  dto: InvoiceSummaryDTO,
  priorInv: Pick<Invoice, "cust" | "phone" | "email">,
): Invoice {
  const total = dto.total.cents / 100;
  const due = dto.due.cents / 100;
  return {
    id: dto.id,
    num: dto.num,
    // The job this bill was raised from — on the summary DTO now, so the link survives a list
    // refetch instead of being nulled on every one.
    jobId: dto.sourceJobId,
    leadId: dto.leadId,
    cust: dto.customerName ?? priorInv.cust,
    phone: priorInv.phone,
    email: priorInv.email,
    title: dto.title ?? "Invoice",
    status: dto.status,
    total,
    depPaid: 0,
    // Everything already paid, deposit included — the server's figure, not a re-derivation.
    paidTotal: Math.max(0, total - due),
    // And the balance itself, which invDue prefers while `partial` is set. Kept in step with
    // the invoices hydrator's toStoreInvoice, the other mapper for this same DTO.
    due,
    payments: [],
    lines: [],
    // A summary row — no lines/jobId/history; deciders must fetch the full record.
    partial: true,
    age: daysSince(dto.createdAt),
    createdAt: dto.createdAt,
    dueAt: dto.dueAt,
    // From the server now — the hydrator used to leave this unset, so the ledger's follow-up
    // state reset on every refetch.
    fu: { on: dto.followUpOn, stage: dto.followUpStage },
    archived: dto.status === "void",
    origin: "db",
  };
}

/**
 * A LIST row → a store Estimate. Header only, same reasoning as the invoice summary above.
 *
 * `cachedTotal` carries the figure the domain computed, which is what estTotal reads when there
 * are no lines — so a rail card shows the right money without the lines being loaded.
 */
export function dtoEstimateSummaryToStore(
  dto: EstimateSummaryDTO,
  fu: Estimate["fu"],
): Estimate {
  return {
    id: dto.id,
    num: dto.num,
    leadId: dto.leadId,
    title: dto.title ?? "Quote",
    status: dto.status,
    age: daysSince(dto.createdAt),
    viewed: dto.status !== "draft",
    fu: dto.followUpOn !== undefined ? { on: dto.followUpOn, stage: dto.followUpStage } : fu,
    lines: [],
    cachedTotal: dto.total.cents / 100,
    archived: false,
    trash: false,
    reads: [],
    publicToken: dto.publicToken ?? undefined,
    publicUrl: dto.publicUrl ?? undefined,
    recommendedTier: dto.recommendedTier ?? undefined,
    acceptedTier: dto.acceptedTier ?? undefined,
    origin: "db",
  } as Estimate;
}

export function dtoInvoiceToStore(dto: InvoiceDTO, priorInv: Invoice): Invoice {
  return {
    id: dto.id,
    num: dto.num,
    jobId: dto.sourceJobId,
    // Carried through in CENTS on purpose — see the note on InvoiceAuthorization. Every other
    // money field on this mapper becomes dollars; a signed amount must not.
    authorization: dto.authorization ?? undefined,
    leadId: dto.leadId,
    // The customer's NAME comes off the wire — the ledger pages through the database, so the
    // store's copy can be stale or absent. Falls back to the prior record only when the server
    // has none (a deleted lead). phone/email are still not in the DTO; money-derive falls back to
    // leads[leadId] for those. Matches the summary mapper, which already preferred the server.
    cust: dto.customerName ?? priorInv.cust,
    phone: priorInv.phone,
    email: priorInv.email,
    // WHERE the work happened and WHEN — the two document facts the invoice row does not hold.
    // Resolved server-side so the office preview cannot state a different service date from the
    // customer's own copy of the same bill.
    serviceAddress: dto.serviceAddress,
    serviceAt: dto.serviceAt,
    title: dto.title ?? "Invoice",
    status: dto.status,
    total: dto.total.cents / 100,              // cents → dollars (TAX-INCLUSIVE)
    // The modal has always drawn a Tax row from `pricing`; until now nothing populated it for an
    // invoice, so the row rendered off client-only state. `disc` stays 0 because an invoice carries
    // no discount of its own — the estimate's discount is already inside the total it snapshotted.
    pricing: { disc: dto.discBps / 100, tax: dto.taxBps / 100 },  // bps → percent (875 = 8.75%)
    tax: dto.tax.cents / 100,                     // cents → dollars, the recorded amount
    disc: dto.discount.cents / 100,               // cents → dollars, what came off before tax
    depPaid: dto.depositPaid.cents / 100,      // cents → dollars
    payments: dto.payments.map((p) => ({
      amt: p.amount.cents / 100,               // cents → dollars
      when: new Date(p.receivedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
      method: p.method,
    })),
    termsDays: dto.termsDays,
    lines: dto.lines.map((l) => ({
      d: l.description,
      q: l.quantity,
      r: l.rate.cents / 100,                                  // cents → dollars
      c: l.cost.cents > 0 ? l.cost.cents / 100 : undefined,  // omit when zero-cost
      ...(l.taxable ? {} : { notax: true as const }),         // only the exception is written
    })),
    // Days since the invoice was raised. Was hard-coded to 0, which made the ledger's age column
    // read "0d" for every row and — while overdue was defined as an age threshold — made the
    // Overdue pill unreachable. Overdue now keys off dueAt below; this is display only.
    age: daysSince(dto.createdAt),
    // The stamp itself, not just the day count: a document of record states a date.
    createdAt: dto.createdAt,
    dueAt: dto.dueAt,
    fu: { on: dto.followUpOn, stage: dto.followUpStage },
    // The public pay link, minted server-side on first send. Threaded so the office modal can
    // hand the customer their link (Task 9's UI); absent until the invoice has been sent.
    poNumber: dto.poNumber ?? undefined,
    publicToken: dto.publicToken ?? undefined,
    publicUrl: dto.publicUrl ?? undefined,
    archived: dto.status === "void",
    origin: "db",
  };
}

/**
 * A FIELD invoice DTO → a store Invoice. The technician's read path.
 *
 * Two things differ from dtoInvoiceToStore, and both are deliberate:
 *
 * 1. `lines` is EMPTIED when the shop hides prices from techs. The wire carries the descriptions
 *    with `rate: null` — "hidden from you", explicitly not $0 — and the store's InvoiceLine has
 *    no way to say that (`r` is a plain number). Writing a 0 there would put a fabricated price
 *    in front of a customer, so the breakdown is dropped instead and the invoice's own `total` /
 *    `due` — which the field DTO always sends, whatever the setting — carry the money. That is
 *    what makes "Balance due $840 — collect" honest on a device that may not see line rates.
 * 2. `publicToken`/`publicUrl`, `authorization`, `poNumber` and the follow-up state are absent
 *    from the wire, so they are absent here. A prior record's copy is NOT carried forward: this
 *    mapper's output must never appear to hold a pay-link the field response did not send.
 *
 * `due` + `paidTotal` are taken from the server rather than re-derived, and `partial` is NOT set:
 * this is a full read of the record, just a narrower one.
 *
 * `priorInv` is OPTIONAL because the field surface has a genuine no-prior path: a technician's
 * store holds no invoices at all (InvoicesHydrator is !isTech-gated and `invoicing.list` is
 * office-only), so `fieldInvoicing.raiseVisitFee` adopts a record this device has never seen. It
 * only ever supplies the three fields the wire does not carry — cust/phone/email — and the
 * customer's name comes back on the DTO anyway.
 */
export function dtoFieldInvoiceToStore(dto: FieldInvoiceDTO, priorInv?: Invoice): Invoice {
  const total = dto.total.cents / 100;
  const due = dto.due.cents / 100;
  const pricesHidden = dto.lines.some((l) => l.rate === null);
  return {
    id: dto.id,
    num: dto.num,
    // The bill's own job. A visit-fee invoice is lead-tied and carries `scopeJobId` instead —
    // deliberately NOT folded in here: it is the job that AUTHORIZES the fee, not the job whose
    // bill this is, and the surfaces that look a job's invoice up by `jobId` must not find it.
    jobId: dto.sourceJobId,
    leadId: dto.leadId,
    cust: dto.customerName ?? priorInv?.cust ?? "",
    phone: priorInv?.phone ?? "",
    email: priorInv?.email,
    // The close-out document the technician turns around states these too — same fields, same
    // server resolution as the office and the customer's own page.
    serviceAddress: dto.serviceAddress,
    serviceAt: dto.serviceAt,
    title: dto.title ?? "Invoice",
    status: dto.status,
    total,
    tax: dto.tax.cents / 100,
    disc: dto.discount.cents / 100,
    depPaid: dto.depositPaid.cents / 100,
    paidTotal: dto.amountPaid.cents / 100,
    due,
    payments: dto.payments.map((p) => ({
      amt: p.amount.cents / 100,
      when: new Date(p.receivedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
      method: p.method,
    })),
    termsDays: dto.termsDays,
    lines: pricesHidden
      ? []
      : dto.lines.map((l) => ({
          d: l.description,
          q: l.quantity,
          r: (l.rate?.cents ?? 0) / 100,
          ...(l.taxable ? {} : { notax: true as const }),
        })),
    age: daysSince(dto.createdAt),
    createdAt: dto.createdAt,
    dueAt: dto.dueAt,
    archived: dto.status === "void",
    origin: "db",
  };
}

// ---------------------------------------------------------------------------
// TimeEntry DTO → store (hydrator + mutation reconcile path)
// ---------------------------------------------------------------------------

/**
 * Map a timeEntryDTO (returned by list/create/update) to a store TimeEntry.
 * The mapping is intentionally kept flat — no money conversions (timesheets
 * deal in hours only).
 */
export function dtoToTimeEntry(dto: TimeEntryDTO): TimeEntry {
  return {
    id: dto.id,
    techId: dto.techUserId,
    date: dto.workDate,
    kind: dto.kind,
    jobId: dto.jobId,
    start: dto.startTime,
    end: dto.endTime,
    minutes: dto.minutes,
    note: dto.note,
    src: dto.src,
    status: dto.status,
    running: dto.running,
    approvedAt: dto.approvedAt ? Date.parse(dto.approvedAt) : undefined,
  };
}

// ---------------------------------------------------------------------------
// PurchaseOrder DTO → store (hydrator + mutation reconcile path)
// ---------------------------------------------------------------------------

// Unlike invoices/estimates, purchasing has ONE dto shape for both the list query and every
// mutation (create/update/place/cancel) — there is no separate summary DTO, because the list
// endpoint already returns full lines. So this one mapper is the whole surface.
export type PurchaseOrderDTO = RouterOutputs["v1"]["purchasing"]["create"];
export type PurchaseOrderNoteDTO = RouterOutputs["v1"]["purchasing"]["addNote"];

/**
 * Map a purchaseOrderDTO to a store PurchaseOrder.
 *
 * Money: DTO carries integer cents; store uses dollars.
 *   freight.cents / 100     → PurchaseOrder.freight     (dollars)
 *   tax.cents / 100         → PurchaseOrder.tax         (dollars)
 *   total.cents / 100       → PurchaseOrder.total       (dollars)
 *   line.amount.cents / 100 → PurchaseOrderLine.amount  (dollars)
 *
 * unitCostMillicents is carried through UNCONVERTED — thousandths of a cent, a RATE rather than
 * a money amount. Dividing it by 100 alongside the fields above would silently corrupt every
 * line's per-unit cost; see the note on PurchaseOrderLine.unitCostMillicents.
 *
 * notes is always [] here: no DTO on this router carries the note trail (it is fetched
 * separately via listNotes). The slice's merge helper — not this pure mapper — is responsible
 * for preserving notes a modal already loaded across a hydrate or reconcile.
 */
export function dtoPurchaseOrderToStore(dto: PurchaseOrderDTO): PurchaseOrder {
  return {
    id: dto.id,
    num: dto.num,
    vendor: dto.vendor,
    status: dto.status,
    jobId: dto.jobId,
    jobTitle: dto.jobTitle,
    orderedAt: dto.orderedAt,
    expectedAt: dto.expectedAt,
    shipTo: dto.shipTo,
    orderedByUserId: dto.orderedByUserId,
    orderedByName: dto.orderedByName,
    freight: dto.freight.cents / 100,
    tax: dto.tax.cents / 100,
    total: dto.total.cents / 100,
    lines: dto.lines.map((l) => ({
      id: l.id,
      description: l.description,
      qty: l.qty,
      uom: l.uom,
      unitCostMillicents: l.unitCostMillicents,
      amount: l.amount.cents / 100,
    })),
    createdAt: dto.createdAt,
    notes: [],
  };
}

/**
 * Map a purchaseOrderNoteDTO (returned by addNote/listNotes) to a store PurchaseOrderNote.
 * No money involved — a straight field carry, same shape as dtoLeadNoteToStore's attachment fold.
 */
export function dtoPurchaseOrderNoteToStore(dto: PurchaseOrderNoteDTO): PurchaseOrderNote {
  return {
    id: dto.id,
    body: dto.body,
    authorUserId: dto.authorUserId,
    authorName: dto.authorName,
    ...(dto.attachmentPath && dto.attachmentType && dto.attachmentName
      ? { attachment: { path: dto.attachmentPath, type: dto.attachmentType, name: dto.attachmentName } }
      : {}),
    createdAt: dto.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Lead stage mapping (store display string ↔ DB enum)
// ---------------------------------------------------------------------------
//
// The store keeps stages as display strings ("New customer", "Quote Sent") —
// the vocabulary STAGE_PILL_CLS / pipeline-lanes / STAGE_ORDER render. The DB
// enum (modules/customers/domain/lead.ts LEAD_STAGES) is
// "new" | "contacted" | "quote_sent" | "won" | "lost". v1.customers.update only
// accepts the enum, so every persisted stage MUST pass through here.

export type BackendStage = "new" | "contacted" | "quote_sent" | "won" | "lost";

/** Display stage → DB enum. Unknown/unrecognised falls back to "new". */
export const STAGE_DISPLAY_TO_BACKEND: Record<string, BackendStage> = {
  "New customer": "new",
  Contacted: "contacted",
  "Quote Sent": "quote_sent",
  Won: "won",
  Lost: "lost",
};

/** DB enum → display stage. Used on hydrate + reconcile. */
const STAGE_BACKEND_TO_DISPLAY: Record<BackendStage, string> = {
  new: "New customer",
  contacted: "Contacted",
  quote_sent: "Quote Sent",
  won: "Won",
  lost: "Lost",
};

const BACKEND_STAGES = new Set<string>(["new", "contacted", "quote_sent", "won", "lost"]);

/**
 * Map a store stage (display OR already-enum) to the DB enum. Idempotent for
 * values that are already enum values; falls back to "new" for anything unknown.
 */
export function storeStageToBackend(stage: string): BackendStage {
  if (BACKEND_STAGES.has(stage)) return stage as BackendStage;
  return STAGE_DISPLAY_TO_BACKEND[stage] ?? "new";
}

/**
 * Map a DB enum stage back to the store display string. Passes through a value
 * that is already a display string; returns the input unchanged if unrecognised.
 */
export function backendStageToStore(stage: string): string {
  if (BACKEND_STAGES.has(stage)) return STAGE_BACKEND_TO_DISPLAY[stage as BackendStage];
  return stage;
}
