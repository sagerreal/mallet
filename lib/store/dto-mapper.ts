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
import { shortWhen } from "@/lib/format";
import type { Addon, Estimate, Invoice, Job, JobLine, LeadNote, TimeEntry, Visit } from "./types";
import { JOB_ORIGIN } from "./hydrator-config";

export type JobDTO = RouterOutputs["v1"]["visits"]["createVisit"];
export type EstimateDTO = RouterOutputs["v1"]["quoting"]["draft"];
export type InvoiceDTO = RouterOutputs["v1"]["invoicing"]["draft"];

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

export type LeadNoteDTO = RouterOutputs["v1"]["customers"]["listNotes"]["items"][number];

/**
 * A persisted activity entry → the store's LeadNote shape, so the note feed renders a server row
 * and a just-typed optimistic one identically. `when` becomes a display string here (the feed
 * shows it verbatim); the ISO stamp is what the server ordered by, and is not needed again.
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

// ---------------------------------------------------------------------------
// DTO → store mappers (public)
// ---------------------------------------------------------------------------

function isPlacedVisit(v: Visit): boolean {
  return !!(v.date && v.techId != null && v.start != null);
}

function recalcJobStatus(visits: Visit[]): string {
  const placed = visits.filter(isPlacedVisit);
  if (!placed.length) return "unscheduled";
  if (placed.every((v) => v.status === "done")) return "done";
  return "scheduled";
}

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
  photos?: { storagePath: string }[];
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
export function mapExecution(dto: ExecutionDTO): Pick<Job, "lines" | "addons" | "photos" | "verify"> {
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

  const photos: string[] = (dto.photos ?? []).map((p) => p.storagePath);

  const verifyAns: Record<string, { st: "pass" | "override"; via?: string; reason?: string }> = {};
  for (const v of dto.verifyAnswers ?? []) {
    verifyAns[v.itemId] = {
      st: v.state,
      ...(v.via ? { via: v.via } : {}),
      ...(v.reason ? { reason: v.reason } : {}),
    };
  }

  return { lines, addons, photos, verify: { ans: verifyAns } };
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
  // When there are active visits, recalc from their placement state.
  // When there are no active visits AND the backend status is "scheduled", remap to
  // "unscheduled" — a zero-visit job has not been slotted yet (this is the common state
  // immediately after a quote is accepted and CreateJobFromEstimateUseCase runs).
  // Only "in_progress", "complete", and "canceled" are preserved as-is via the fallback.
  const status = visits.length > 0
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
    origin: JOB_ORIGIN.DB,
    title: dto.title ?? "Job",
    addr: dto.addr ?? "",
    phone: dto.phone ?? "",
    status,
    archived: false,
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
    lines: dto.lines.map((l) => ({
      d: l.description,
      q: l.quantity,
      r: l.rate.cents / 100,                                  // cents → dollars
      c: l.cost.cents > 0 ? l.cost.cents / 100 : undefined,  // omit when zero-cost
      opt: l.isOptional || undefined,
      photo: l.needsPhoto || undefined,
      tier: l.tier ?? undefined,                              // GBB tier tag (null → absent)
    })),
    pricing: {
      disc: dto.discBps / 100,   // basis points → percent (1000 bps = 10%)
      tax: dto.taxBps / 100,
      dep: dto.depBps / 100,
    },
    cachedTotal: dto.total.cents / 100,   // cents → dollars
    publicToken: dto.publicToken ?? undefined,  // null → undefined (absent when not yet set)
    publicUrl: dto.publicUrl ?? undefined,
    changeRequestedAt: dto.changeRequestedAt ?? undefined,
    changeRequest: dto.changeRequest ?? undefined,
    // Good/Better/Best — tier fields ride the DTO as-is (no money units involved;
    // the DTO's total above already derives from the recommended/accepted tier).
    recommendedTier: dto.recommendedTier ?? undefined,
    acceptedTier: dto.acceptedTier ?? undefined,
    tierNames: dto.tierNames ?? undefined,
    termsSnapshot: dto.termsSnapshot ?? undefined,
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
    jobId: null,
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
    payments: [],
    lines: [],
    // A summary row — no lines/jobId/history; deciders must fetch the full record.
    partial: true,
    age: daysSince(dto.createdAt),
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
    // cust/phone/email are not in the DTO; money-derive falls back to leads[leadId].name.
    cust: priorInv.cust,
    phone: priorInv.phone,
    email: priorInv.email,
    title: dto.title ?? "Invoice",
    status: dto.status,
    total: dto.total.cents / 100,              // cents → dollars (TAX-INCLUSIVE)
    // The modal has always drawn a Tax row from `pricing`; until now nothing populated it for an
    // invoice, so the row rendered off client-only state. `disc` stays 0 because an invoice carries
    // no discount of its own — the estimate's discount is already inside the total it snapshotted.
    pricing: { disc: 0, tax: dto.taxBps / 100 },   // basis points → percent (875 bps = 8.75%)
    tax: dto.tax.cents / 100,                     // cents → dollars, the recorded amount
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
    })),
    // Days since the invoice was raised. Was hard-coded to 0, which made the ledger's age column
    // read "0d" for every row and — while overdue was defined as an age threshold — made the
    // Overdue pill unreachable. Overdue now keys off dueAt below; this is display only.
    age: daysSince(dto.createdAt),
    dueAt: dto.dueAt,
    fu: { on: dto.followUpOn, stage: dto.followUpStage },
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
    note: dto.note,
    src: dto.src,
    status: dto.status,
    running: dto.running,
    approvedAt: dto.approvedAt ? Date.parse(dto.approvedAt) : undefined,
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
