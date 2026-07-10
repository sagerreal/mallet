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

export interface EstimateLine {
  d: string;
  q: number;
  r: number;
  photo?: boolean;
  opt?: boolean;
  c?: number;
  h?: number;
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
  age: number;
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
  archived?: boolean;
  trash?: boolean;
}

// ---- Job -------------------------------------------------------------------

export interface JobLine {
  d: string;
  q: number;
  r: number;
  c?: number;
}

// Found-work / add-on discovered in the field (prototype j.addons[] — addAddon).
// Proposed → approved (customer OK'd, bills) | declined. invSkip = left off the
// current bill but kept on the job.
export interface Addon {
  id: number;
  d: string;
  q: number;
  r: number;
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
  id: number;
  text: string;
  type: "check" | "photo";
  required: boolean;
}

export interface Checklist {
  id: number;
  name: string;
  trade: string;
  stage: "job" | "scope";
  match: string[];
  items: ChecklistItem[];
}

export interface Job {
  id: string;
  leadId: string;
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
  // Before-you-leave checklist answers, keyed by checklist item id.
  verify?: { ans: Record<number, VerifyAns> };
  acts: unknown[];
  visits: Visit[];
  checklist?: { name: string; items: ChecklistItem[] };
  // Field close-out (tech done-block): what-was-done note shown on the invoice,
  // and the "handed to the office to bill" flag.
  completion?: string;
  invRequested?: boolean;
  expected?: number;
  // Set when the customer approved & signed a quote on the tech's tablet (tqSign).
  approvedOnSite?: boolean;
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
  total: number;
  depPaid: number;
  payments: Payment[];
  status: string;
  age: number;
  fu?: { on: boolean; stage: number };
  archived: boolean;
  /**
   * Whether the invoice exists in the DB ("db") or was created locally ("manual").
   * Only "db" invoices fire network mutations for recordPayment, sendInvoice, archiveInvoice.
   * Set to "db" on reconcile from a backend DTO.
   */
  origin?: "db" | "manual";
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
  phase: "live" | "ended";
}
