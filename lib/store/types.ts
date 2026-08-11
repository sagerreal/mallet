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
  /**
   * WHEN each step was actually tapped — ISO timestamps, straight off the visit row.
   *
   * These are the visit's own stamps (`job_visits.enroute_at / started_at / completed_at`), not
   * the plan: `startedAt` IS the arrival, and there is no `arrived_at` column. The DTO has
   * carried all three since the column landed; `toStoreVisit` simply dropped them, so the client
   * could say WHICH state a visit was in but never WHEN it got there.
   *
   * NULL IS LOAD-BEARING. A visit finished without anyone tapping On my way / Arrived keeps
   * nulls here — the server does not backfill them, and neither may the UI. A stepper that
   * printed an arrival nobody recorded would be a fabrication in a record that can end up in an
   * argument with a customer. Absent means skipped; it does not mean unknown.
   */
  enrouteAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  scopeNotes?: string;
  photos?: string[];
}

export interface Lead {
  id: string;
  name: string;
  phone: string;
  /** Office-defined {label, value} pairs — persisted on the lead. */
  customFields?: { label: string; value: string }[] | null;
  source: string;
  stage: string;
  age: number;
  job: string;
  /** Prose "what happened last" — prototype sample data and optimistic in-session writes only. */
  last: string;
  /** ISO stamp behind the Latest column. Distinct from `last`: this is the DB's updated_at, the
      value the list is already ordered by, and the only one a fresh page load can show. */
  lastActivityAt?: string;
  book?: boolean;
  unread?: boolean;
  estId?: string;
  email?: string;
  address?: string;
  companyId?: string | null;
  role?: string;
  value?: number;
  lossReason?: string;
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
  /**
   * This line is NOT taxable — the shop's rate is not charged on it.
   *
   * Stated as the EXCEPTION, absent on an ordinary line, because taxable is the default
   * everywhere else in the stack (`estimate_lines.taxable NOT NULL DEFAULT true`). A `taxable?:`
   * key would read as false when omitted and silently drop lines out of the tax base.
   */
  notax?: boolean;
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
   * Deposit actually COLLECTED on this quote, in DOLLARS. Distinct from pricing.dep, which is the
   * percentage ASKED for — a quote can be accepted with a 30% deposit due and nothing paid, and
   * telling those apart is the whole point of showing it. Absent until a full estimateDTO lands
   * (the list summary omits it) and for locally-created estimates, where it is necessarily 0.
   */
  depPaid?: number;
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
   * The scope-visit job this quote prices — the walkthrough the composer was opened from
   * (?job=). Accepting the quote CONVERTS that job into the sold work instead of minting a
   * duplicate. Absent on quotes with no visit behind them.
   */
  jobId?: string | null;
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
  /** 'work' | 'estimate' — is this a scoping visit? Source of truth since 0133; svc is
      purely the trade label. */
  kind?: string;
  origin: string;
  title: string;
  addr: string;
  phone: string;
  status: string;
  archived: boolean;
  lines: JobLine[];
  /**
   * The job's stored discount / sales-tax rates, in PERCENT (10 = 10%), mirroring
   * Estimate.pricing. Written by the pricing paths (office Build the price, field
   * saveQuoteDraft/signQuote); absent when both are zero. No deposit here — jobs
   * hold no deposit rate; a deposit rides the signed/sent document (estimate).
   */
  pricing?: { disc: number; tax: number };
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
  /** This line is NOT taxable. The exception, absent on an ordinary line — same convention as
   *  the estimate line's `notax`. */
  notax?: boolean;
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
  /** Customer-supplied purchase order number. Read-only in the store (edit UI is Task 9). */
  poNumber?: string;
  /** The public pay-link token, minted server-side on first send. */
  publicToken?: string;
  /** Absolute customer-facing pay URL (server-composed from the canonical origin). */
  publicUrl?: string;
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
  /**
   * What came off the line sum before tax, in dollars, as recorded when the invoice was raised.
   *
   * The document prints the lines at their full rates, so without this a total below their sum
   * has nothing explaining it. 0 on an undiscounted bill.
   */
  disc?: number;
  depPaid: number;
  payments: Payment[];
  /**
   * Everything already paid on this invoice, in dollars — deposit included.
   *
   * Present only on records built from a LIST row, where the payment history is not sent. The
   * balance is normally the sum of `payments`; with none loaded, every ledger row would read as
   * fully unpaid. The server already computed the balance, so this carries its answer and
   * `invPaid` prefers it. Absent on a fully-loaded invoice, where the payments ARE the truth.
   */
  paidTotal?: number;
  /**
   * The balance the SERVER says is still owed, in dollars — present only on a `partial` row.
   *
   * A summary DTO carries no deposit and no payment history, so a balance re-derived from the
   * parts on this record reads the whole total as owed. `invDue` prefers this figure while
   * `partial` is set; a fully-loaded invoice has none, because there the parts ARE the truth.
   */
  due?: number;
  /**
   * True when this row was built from a LIST/summary DTO — no lines, no jobId, no payment
   * history. A surface that DECIDES anything from those fields (the invoice modal choosing
   * editor vs read-only) must wait for the full record instead of trusting a partial row:
   * a job's draft with `jobId: null` from a summary opened the hand-made-draft editor —
   * empty Bill-to, "No lines yet" — under a real $685 bill. Cleared by adopting the full DTO.
   */
  partial?: true;
  status: string;
  /** Days since the invoice was raised. Display only — "overdue" is `dueAt`, not this. */
  age: number;
  /**
   * When the bill was RAISED, ISO — invoices.created_at, verbatim.
   *
   * `age` is derived from the same stamp but is a count of days, and a document of record states a
   * date. Absent only on a locally-created ("manual") invoice that has never been persisted.
   */
  createdAt?: string;
  /**
   * WHERE the work happened — the lead's address, resolved SERVER-side and carried on the record.
   *
   * Not looked up in `leads` here on purpose: a technician's store holds no leads at all
   * (LeadsHydrator is office-only), and the office ledger pages through the database, so neither
   * surface can be relied on to hold this invoice's lead. Frequently null — most leads are created
   * without an address — and the document omits the block when it is.
   */
  serviceAddress?: string | null;
  /**
   * WHEN the work was done, ISO — the source job's latest completed visit, resolved server-side.
   *
   * NEVER a synonym for `createdAt`. A bill with no source job or no completed visit has none, and
   * the document omits the row: a customer may hand this to an insurer or a warranty desk, and a
   * date that is not the service date under a "Service" label is a false statement.
   */
  serviceAt?: string | null;
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

/**
 * WHO the shop is, as a customer document states it — distinct from `Brand`, which is how the shop
 * LOOKS (colour, monogram, tagline).
 *
 * `null` in the store until BusinessIdentityHydrator lands, and that is load-bearing: the invoice
 * document omits the whole identity block rather than printing the brand placeholder
 * ("My Business") to a customer. Everything but `name` is nullable — an unset field prints nothing.
 */
export interface BusinessIdentity {
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  site: string | null;
  license: string | null;
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
  // Which way this call is being carried: "browser" means Mallet itself is the phone (mic and
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

// ---- Site captures (aerial takeoff — outdoor surfaces) ----------------------

export interface SiteVertex {
  lat: number;
  lng: number;
}

/** The map view the surface was traced against — reopening re-centers here. */
export interface SiteMapView {
  centerLat: number;
  centerLng: number;
  zoom: number;
}

/** A classed roof line drawn inside the footprint (a hip roof's ridge). */
export interface SiteInteriorLineShape {
  a: SiteVertex;
  b: SiteVertex;
  cls: "ridge" | "hip" | "valley";
}

export interface SitePolygonShape {
  vertices: SiteVertex[];
  view: SiteMapView;
  /**
   * Roof edge classes, parallel to vertices (edge i = vertex i → i+1,
   * wrapping). Absent on legacy captures and flat surfaces — unclassified.
   */
  edgeClasses?: ("eave" | "rake" | "ridge" | "hip" | "valley")[];
  interiorLines?: SiteInteriorLineShape[];
}

/** Server-derived plan-view feet per edge class; null when unclassified. */
export interface SiteEdgeTotals {
  eaveFt: number;
  rakeFt: number;
  ridgeFt: number;
  hipFt: number;
  valleyFt: number;
}

/** Waste-relevant complexity hint — any hips/valleys mark the roof cut-up. */
export interface SiteComplexity {
  hips: number;
  valleys: number;
  cutUp: boolean;
}

/**
 * One outdoor surface (driveway, patio, roof facet) traced on satellite
 * imagery or entered by hand. areaSqft is the WORKING number — the server
 * recomputes it from footprint + pitch for traced captures; never trust a
 * locally derived value past the preview.
 */
export interface SiteCard {
  id: string;
  jobId: string;
  name: string;
  source: "aerial_trace_v1" | "manual";
  surface: "flat" | "pitched";
  pitchRise: number | null; // rise per 12; null for flat
  areaSqft: number;
  footprintSqft: number | null;
  perimeterLnft: number | null;
  polygon: SitePolygonShape | null; // null for manual entries
  /** Per-class linears + complexity, server-derived; null when unclassified. */
  edges: SiteEdgeTotals | null;
  complexity: SiteComplexity | null;
  createdAt: string; // ISO string
}
