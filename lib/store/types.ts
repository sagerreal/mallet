/**
 * lib/store/types.ts
 * Store domain types — mirrors prototype state shape (§1 of interaction map).
 * Kept separate so slices can import without circular deps.
 */

import type { ModalId } from "./modal-ids";

// ---- Lead / Customer -------------------------------------------------------

export interface LeadNote {
  id?: string;
  type: "note" | "call" | "text" | "system" | "visit" | "ai";
  /** Happened on the Front Desk's overnight shift — feeds the home Handoff note. */
  overnight?: boolean;
  dir?: string;
  outcome?: string;
  dur?: string;
  via?: string;
  when: string;
  from?: string;
  t?: string;
  notes?: string;
}

export interface Visit {
  id: string;
  // Placement fields are null while a visit is "unscheduled" (in the To-schedule
  // tray); set when dragged/placed on the board (crew + day + start).
  date: string | null;
  techId: string | null;
  start: number | null;
  dur: number;
  status: string;
  /** Clock stamp when the crew marked on site ("9:04") — powers the live dot. */
  onsiteAt?: string;
  scopeNotes?: string;
  photos?: string[];
}

export interface Lead {
  id: string;
  name: string;
  phone: string;
  source: string;
  stage: string;
  age: number;
  job: string;
  last: string;
  book?: boolean;
  unread?: boolean;
  estId?: string;
  email?: string;
  address?: string;
  companyId?: string;
  role?: string;
  value?: number;
  lossReason?: string;
  evisits?: Visit[];
  acts?: LeadNote[];
  notes?: string;
  card?: { brand: string; last4: string; via: string };
  custom?: Record<string, string>;
  archived?: boolean;
  trash?: boolean;
}

// ---- Task ------------------------------------------------------------------

export interface Task {
  id: string;
  t: string;
  due: string | null;
  leadId: string | null;
  done?: boolean;
}

// ---- Company ---------------------------------------------------------------

export interface Company {
  id: string;
  name: string;
  sites: unknown[];
  phone: string;
  email: string;
  website?: string;
  address?: string;
  notes?: string;
  archived?: boolean;
}

// ---- Estimate / Quote ------------------------------------------------------

/** Good/Better/Best tier key — mirrors the DB CHECK on estimates/estimate_lines. */
export type QuoteTierKey = "good" | "better" | "best";

/** Editable display names for the three tiers ("Good"/"Better"/"Best" defaults). */
export interface TierNames {
  good: string;
  better: string;
  best: string;
}

export interface EstimateLine {
  d: string;
  q: number;
  r: number;
  photo?: boolean;
  opt?: boolean;
  c?: number;
  h?: number;
  /** GBB tier tag. Set on every line of a tiered estimate; absent on single quotes. */
  tier?: QuoteTierKey;
}

/** One customer open of the quote page — the telemetry unit the Rail renders. */
export interface EstimateRead {
  /** Clock stamp in the ledger voice ("9:12pm", "Fri"). */
  when: string;
  /** Business days ago (0 = today/last night) — drives cooling + recency. */
  daysAgo: number;
  /** Session currently open — the breathing dot. Dies on close. */
  live?: boolean;
  /** 2 = a phone that isn't the customer's (a forward). */
  device?: number;
}

export interface Estimate {
  id: string;
  num: string;
  leadId: string;
  title: string;
  status: string;
  /** Days since the invoice was raised. Display only — "overdue" is `dueAt`, not this. */
  age: number;
  /**
   * When payment is due, ISO date, or null when the invoice was never sent.
   *
   * This is what OVERDUE means — past this date and still owed. It used to be inferred from `age`
   * exceeding a fixed seven days, which ignored the terms actually agreed with the customer and,
   * because the mapper hard-coded `age: 0`, could never be true for an invoice loaded from the
   * database. The Overdue pill was unreachable and the Overdue filter matched nothing.
   */
  dueAt?: string | null;
  viewed: boolean;
  validDays?: number;
  fu: { on: boolean; stage: number };
  lines: EstimateLine[];
  pricing?: { disc: number; dep: number; tax: number };
  /** Customer opens, oldest → newest. The customer is never told these exist. */
  reads?: EstimateRead[];
  /**
   * Cached list-view total in DOLLARS — populated by the hydrator from the
   * summary DTO's total.cents / 100. Used by estTotal() when full lines haven't
   * been loaded yet (lines === []). Undefined for locally-created estimates
   * (calcQuote over lines is authoritative instead).
   */
  cachedTotal?: number;
  /**
   * The unguessable share token for the customer-facing quote page (/q/<token>).
   * Populated by dtoEstimateToStore when the full estimateDTO is returned by a
   * mutation (draft/send/accept/decline/restore). Absent for list-hydrated
   * records (the summary DTO omits it) and locally-created estimates.
   */
  publicToken?: string;
  /**
   * The finished customer-facing link, composed SERVER-side from the configured canonical origin.
   * Absent only when the server can resolve no canonical origin at all — the send path then refuses
   * rather than inventing one, because a link built from the sender's browser location is only
   * correct by luck (a deployment URL sends the customer to a Vercel sign-in page).
   */
  publicUrl?: string;
  /** ISO timestamp when the customer last requested a change. */
  changeRequestedAt?: string;
  /** The customer's change request message. */
  changeRequest?: string;
  /**
   * Good/Better/Best: set = tiered estimate (every line carries a tier tag).
   * Totals derive from this tier pre-accept; absent on single quotes.
   */
  recommendedTier?: QuoteTierKey;
  /** The tier the customer (or office) chose at accept — lines are resolved by then. */
  acceptedTier?: QuoteTierKey;
  /** Display names for the three tiers (fallback: Good/Better/Best). */
  tierNames?: TierNames;
  /** Terms text frozen at draft time — later term edits never rewrite sent quotes. */
  termsSnapshot?: string;
  /**
   * The customer's signature, absent when nobody signed.
   *
   * Absent is a REAL state, not missing data: the office can mark a quote accepted after a phone
   * call, and that acceptance carries no signature. Every surface that says "Signed" must branch
   * on this rather than on `status === "accepted"` — see the note on EstimateSignature.
   *
   * Money stays in CENTS here, unlike the rest of the store, which is dollars. The snapshot is a
   * frozen legal record: converting it would mean the number a shop reads off the screen is one
   * this app computed rather than the one the customer signed, and rounding drift in an evidence
   * record is exactly the kind of discrepancy a customer's lawyer points at.
   */
  signature?: EstimateSignature;
  /**
   * Whether a customer signed — available on LIST-hydrated records, where `signature` is not.
   *
   * The two are not redundant. Every quote row in the lead modal renders from list data, and those
   * rows have to tell "Signed" from "Accepted" immediately; the full evidence only arrives when the
   * modal opens and fetches the record. Anything that merely needs the fact branches on this,
   * anything that displays the evidence branches on `signature`.
   */
  signed?: boolean;
  archived?: boolean;
  trash?: boolean;
}

/**
 * Signature evidence as the office sees it.
 *
 * Read-only, and deliberately NOT normalised into the rest of the Estimate shape: these fields
 * describe a moment that already happened, and merging them into the live quote would invite a
 * later edit to overwrite them.
 */
export interface EstimateSignature {
  signerName: string;
  /** SVG path data, or null when the customer signed by typing their name only. */
  signatureSvg: string | null;
  signerIp: string | null;
  signerUserAgent: string | null;
  signedAt: string;
  /** The document as it stood at signing. Totals here — never the live estimate's. */
  snapshot: {
    estimateNum: string;
    totalCents: number;
    depositCents: number;
    chosenTier: string | null;
    authorizationText: string;
    lines: { description: string; quantity: number; rateCents: number }[];
  };
}

// ---- Job -------------------------------------------------------------------

export interface JobLine {
  d: string;
  q: number;
  /** Rate in dollars. null = server-redacted (tech device with techSeesPrice off) — not $0. */
  r: number | null;
  c?: number;
}

// Found-work / add-on discovered in the field (prototype j.addons[] — addAddon).
// Proposed → approved (customer OK'd, bills) | declined. invSkip = left off the
// current bill but kept on the job.
export interface Addon {
  id: number;
  /** DB uuid for persistence; id stays numeric for the prototype UI. */
  dbId?: string;
  d: string;
  q: number;
  /** Rate in dollars. null = server-redacted (tech device with techSeesPrice off) — not $0. */
  r: number | null;
  c?: number;
  status: "proposed" | "approved" | "declined";
  when?: string;
  invSkip?: boolean;
}

// One before-you-leave checklist answer (prototype j.verify.ans[itemId]).
// pass = checked (via 'manual' tap or 'photo'); override = N/A / declined w/ reason.
export interface VerifyAns {
  st: "pass" | "override";
  via?: string;
  reason?: string;
}

export interface ChecklistItem {
  id: string;
  text: string;
  type: "check" | "photo";
  required: boolean;
  position: number;
}

export interface Checklist {
  id: string;
  name: string;
  trade: string;
  stage: "job" | "scope";
  match: string[];
  items: ChecklistItem[];
}

// ---- Pricebook (services + categories) -------------------------------------
// Dollars in the store; the DB/domain/DTOs carry integer cents (unitPriceCents/
// costCents) — conversion lives only in lib/store/pricebook-mapper.ts.

export interface Service {
  id: string;
  categoryId: string | null;
  code: string | null;
  name: string;
  unitPrice: number; // dollars
  cost: number; // dollars
  laborHours: number | null;
  taxable: boolean;
  warrantyText: string | null;
  imageUrl: string | null;
  isAddon: boolean;
  active: boolean;
  position: number;
  // Plain string|null passthrough — when set, unitPrice is a PER-UNIT rate against this
  // measured room quantity kind (e.g. painting walls priced per sqft) rather than a flat price.
  // Null = today's flat-price semantics, unchanged. Kind values mirror
  // modules/pricebook/domain/service.ts's PaintingQuantityKind.
  measuredBy: string | null;
}

export interface Category {
  id: string;
  parentId: string | null;
  name: string;
  sortOrder: number;
}

// ---- Pricebook materials (hidden cost ingredients, Phase 2a) ---------------
// Dollars in the store; the DB/domain/DTOs carry integer cents (unitCostCents) —
// conversion lives only in lib/store/pricebook-mapper.ts. markupBps stays basis
// points end-to-end (no dollars conversion applies to it).

export interface Material {
  id: string;
  categoryId: string | null;
  code: string | null;
  name: string;
  description: string | null;
  unitCost: number; // dollars
  /** Sell price in dollars — what the customer pays. rule = derived from cost via the
   * org's markup bands; manual = the shop's own number. */
  unitPrice: number;
  pricingMode: "rule" | "manual";
  unitOfMeasure: string;
  markupBps: number | null;
  taxable: boolean;
  vendor: string | null;
  active: boolean;
  position: number;
}

/** A service<->material join row: how much of a material a service consumes. */
export interface ServiceMaterialLink {
  serviceId: string;
  materialId: string;
  quantity: number;
}

export interface Job {
  id: string;
  leadId: string;
  /** UUID of the accepted estimate this job was created from, or null/undefined. */
  sourceEstimateId?: string | null;
  /**
   * On-glass signature captured at the customer's door, absent when the job was never signed
   * on site. Shares EstimateSignature so one SignatureRecord renders both paths.
   *
   * Full-record only: the summary DTO omits it, because a board of thirty jobs does not need
   * thirty frozen documents to draw a card.
   */
  signature?: EstimateSignature;
  svc: string | null;
  origin: string;
  title: string;
  addr: string;
  phone: string;
  status: string;
  archived: boolean;
  lines: JobLine[];
  addons: Addon[];
  photos: string[];
  notes: string;
  special?: string;
  prep?: string;
  // Before-you-leave checklist answers, keyed by checklist item id (string).
  verify?: { ans: Record<string, VerifyAns> };
  acts: unknown[];
  visits: Visit[];
  checklist?: { name: string; items: ChecklistItem[] };
  /** Required cert tags resolved from the booking playbook; null means no requirement. */
  requiredCerts?: string[] | null;
  // Field close-out (tech done-block): what-was-done note shown on the invoice,
  // and the "handed to the office to bill" flag.
  completion?: string;
  invRequested?: boolean;
  expected?: number;
  // "Approved on site" (the customer signed a quote on the tech's tablet) is DERIVED
  // from the job carrying priced lines (lines.length > 0), not stored: the lines ARE
  // the approval, and a separate flag would need a single-writer DB migration. No
  // surface reads a stored flag today — jobTotal(job) > 0 already gates the priced UI.
}

// ---- Invoice ---------------------------------------------------------------

export interface InvoiceLine {
  d: string;
  q: number;
  r: number;
  c?: number;
}

export interface Payment {
  amt: number;
  when: string;
  method: string;
  onFile?: boolean;
}

export interface Invoice {
  id: string;
  num: string;
  jobId: string | null;
  leadId: string;
  cust: string;
  phone: string;
  title: string;
  email?: string;
  termsDays?: number | null;
  lines: InvoiceLine[];
  pricing?: { disc: number; tax: number };
  /** Dollars, TAX-INCLUSIVE — the snapshot from the job, not a sum of `lines`. */
  total: number;
  /**
   * How much of `total` is sales tax, in dollars, as recorded when the invoice was raised.
   *
   * Must NOT be recomputed from `lines`: an invoice raised from a quote carries the agreed total
   * with no lines at all, so a line-derived tax renders $0.00 under a four-figure total.
   */
  tax?: number;
  depPaid: number;
  payments: Payment[];
  status: string;
  /** Days since the invoice was raised. Display only — "overdue" is `dueAt`, not this. */
  age: number;
  /**
   * When payment is due, ISO date, or null when the invoice was never sent.
   *
   * This is what OVERDUE means — past this date and still owed. It used to be inferred from `age`
   * exceeding a fixed seven days, which ignored the terms actually agreed with the customer and,
   * because the mapper hard-coded `age: 0`, could never be true for an invoice loaded from the
   * database. The Overdue pill was unreachable and the Overdue filter matched nothing.
   */
  dueAt?: string | null;
  fu?: { on: boolean; stage: number };
  archived: boolean;
  /**
   * Whether the invoice exists in the DB ("db") or was created locally ("manual").
   * Only "db" invoices fire network mutations for recordPayment, sendInvoice, archiveInvoice.
   * Set to "db" on reconcile from a backend DTO.
   */
  origin?: "db" | "manual";
  /**
   * What the customer signed for this work, resolved server-side from job → estimate.
   *
   * Absent when nothing was signed, which is a real state and NOT a warning condition: no signed
   * amount means there is nothing to exceed. `overage` is present only when a signature exists AND
   * this bill is larger than it.
   *
   * CENTS, not dollars, unlike the rest of this interface — it is a frozen legal figure, and a
   * number this app divided by 100 is no longer the number on the signed document.
   */
  authorization?: InvoiceAuthorization;
}

/** Read-only. Resolved on every full-invoice read; never stored on the invoice row. */
export interface InvoiceAuthorization {
  source: "job" | "estimate";
  signerName: string;
  signedAt: string;
  /** "EST-1042" or a job number — the document the shop can point at. */
  documentRef: string;
  authorizedCents: number;
  /** Set ONLY when this bill exceeds what was signed. The part nobody authorised. */
  overage: { authorizedCents: number; invoicedCents: number; excessCents: number } | null;
}

// ---- Time entry (Timesheets) -----------------------------------------------

// A normalized payroll punch — mirrors the prototype's state.timeEntries[] shape.
// Job time also rides on visits (job costing); these entries are the payroll
// record of the same hours. HOURS only — payroll owns the wage.
export interface TimeEntry {
  id: string;
  techId: string;
  date: string; // ISO (YYYY-MM-DD)
  kind: string; // 'job' | 'travel' | 'break' | 'shop'
  jobId: string | null;
  start: string; // 'HH:MM'
  end: string | null;
  note: string;
  src: string; // 'manual' | 'clock' | 'timer'
  status: string; // 'draft' | 'approved'
  running?: boolean;
  approvedAt?: number;
}

// ---- Misc ------------------------------------------------------------------

export interface Tech {
  id: string;
  name: string;
  initials: string;
  color: string;
  skills: string[];
  wage: number;
  sells?: boolean;
}

export interface Brand {
  site: string;
  name: string;
  initials: string;
  color: string;
  tagline: string;
  logoUrl?: string;
}

// ---- UI state --------------------------------------------------------------

export interface ActiveModal {
  id: ModalId;
  params?: Record<string, unknown>;
}

export interface UIState {
  activeModal: ActiveModal | null;
  /** Parents of the active modal (drill-ins via pushModal) — closeModal pops. */
  modalStack: ActiveModal[];
  custSeg: "people" | "biz";
  /** Home "Needs your OK" items the owner skipped — never lead again this session. */
  dismissedAttention: string[];
  /** A query handed to the command bar from elsewhere (e.g. the Home ask row). */
  cmdSeed: string | null;
}

// ---- Active call (global call bar) -----------------------------------------

export interface ActiveCall {
  leadId: string;
  sec: number;
  notes: string;
  // connecting → the provider is ringing the agent's own phone; live → bridged and timing;
  // failed → the call was never placed; ended → hung up, awaiting a disposition.
  phase: "connecting" | "live" | "failed" | "ended";
  // The server-side outbound_calls id, set once the call is actually placed. Null while
  // connecting, and null forever on failure — the outcome can only be logged against a real call.
  callId: string | null;
  // Why placing the call failed, shown in the bar. Null unless phase is "failed".
  error: string | null;
  // Which way this call is being carried: "browser" means Elas itself is the phone (mic and
  // speakers), "phone" means the caller's own handset was rung and bridged. The bar only offers
  // mute and a keypad for a call it is actually carrying.
  transport: "phone" | "browser";
  // Our microphone is silenced. Browser calls only — on a bridged call the handset owns this.
  muted: boolean;
}

// ---- Measurements (room captures) ------------------------------------------
// No money in this domain. Dates stay ISO strings in-store (matches dto-mapper's
// `receivedAt` convention) — nothing here needs Date arithmetic client-side.

export type RoomQuantityKind =
  | "walls_sqft"
  | "ceiling_sqft"
  | "baseboard_lnft"
  | "crown_lnft"
  | "doors_count"
  | "windows_count";

export type RoomQuantityStatus = "derived" | "override" | "confirmed" | "needs_confirm";

export interface RoomQuantity {
  kind: RoomQuantityKind;
  value: number | null;
  derivedValue: number | null;
  status: RoomQuantityStatus;
}

export interface RoomCard {
  id: string;
  jobId: string;
  roomName: string;
  source: "roomplan_v1" | "manual";
  capturedAt: string; // ISO string
  quantities: RoomQuantity[];
}
