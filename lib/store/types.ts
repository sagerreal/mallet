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
  id: number;
  // Placement fields are null while a visit is "unscheduled" (in the To-schedule
  // tray); set when dragged/placed on the board (crew + day + start).
  date: string | null;
  techId: number | null;
  start: number | null;
  dur: number;
  status: string;
  scopeNotes?: string;
  photos?: string[];
}

export interface Lead {
  id: number;
  name: string;
  phone: string;
  source: string;
  stage: string;
  age: number;
  job: string;
  last: string;
  book?: boolean;
  unread?: boolean;
  estId?: number;
  email?: string;
  address?: string;
  companyId?: number;
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
  id: number;
  t: string;
  due: string;
  leadId: number | null;
  done?: boolean;
}

// ---- Company ---------------------------------------------------------------

export interface Company {
  id: number;
  name: string;
  sites: unknown[];
  phone: string;
  email: string;
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

export interface Estimate {
  id: number;
  num: string;
  leadId: number;
  title: string;
  status: string;
  age: number;
  viewed: boolean;
  validDays?: number;
  fu: { on: boolean; stage: number };
  lines: EstimateLine[];
  pricing?: { disc: number; dep: number; tax: number };
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
  id: number;
  leadId: number;
  svc: string;
  origin: string;
  title: string;
  addr: string;
  phone: string;
  status: string;
  archived: boolean;
  lines: JobLine[];
  addons: unknown[];
  photos: string[];
  notes: string;
  special?: string;
  acts: unknown[];
  visits: Visit[];
  checklist?: { name: string; items: ChecklistItem[] };
}

// ---- Invoice ---------------------------------------------------------------

export interface InvoiceLine {
  d: string;
  q: number;
  r: number;
}

export interface Payment {
  amt: number;
  when: string;
  method: string;
}

export interface Invoice {
  id: number;
  num: string;
  jobId: number | null;
  leadId: number;
  cust: string;
  phone: string;
  title: string;
  lines: InvoiceLine[];
  total: number;
  depPaid: number;
  payments: Payment[];
  status: string;
  age: number;
  fu?: { on: boolean; stage: number };
  archived: boolean;
}

// ---- Time entry (Timesheets) -----------------------------------------------

// A normalized payroll punch — mirrors the prototype's state.timeEntries[] shape.
// Job time also rides on visits (job costing); these entries are the payroll
// record of the same hours. HOURS only — payroll owns the wage.
export interface TimeEntry {
  id: number;
  techId: number;
  date: string; // ISO (YYYY-MM-DD)
  kind: string; // 'job' | 'travel' | 'break' | 'shop'
  jobId: number | null;
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
  id: number;
  name: string;
  initials: string;
  color: string;
  skills: string[];
  wage: number;
  sells?: boolean;
}

export interface User {
  id: number;
  name: string;
  role: string;
  email: string;
  mobile: string;
  mobileVerified: boolean;
  techId?: number;
}

export interface Brand {
  site: string;
  name: string;
  initials: string;
  color: string;
  tagline: string;
}

// ---- UI state --------------------------------------------------------------

export interface ActiveModal {
  id: ModalId;
  params?: Record<string, unknown>;
}

export interface UIState {
  activeModal: ActiveModal | null;
  custSeg: "people" | "biz";
}

// ---- Active call (global call bar) -----------------------------------------

export interface ActiveCall {
  leadId: number;
  sec: number;
  notes: string;
  phase: "live" | "ended";
}
