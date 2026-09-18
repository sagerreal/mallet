/**
 * features/jobs/test-factories.ts
 * Minimal, immutable fixture builders for the Jobs pure-logic unit tests.
 * Each builder fills required store-shape fields with innocuous defaults and
 * spreads overrides last, so a test states only the fields it cares about.
 */

import type { Invoice, Job, Lead, Tech, TimeEntry, Visit } from "@/lib/store/types";

export function mkVisit(overrides: Partial<Visit> = {}): Visit {
  return {
    id: "1",
    date: null,
    techId: null,
    start: null,
    dur: 2,
    status: "scheduled",
    ...overrides,
  };
}

export function mkJob(overrides: Partial<Job> = {}): Job {
  return {
    id: "1",
    leadId: "1",
    svc: "service",
    origin: "office",
    title: "Job",
    addr: "1 Main St",
    phone: "555-0100",
    status: "scheduled",
    archived: false,
    lines: [],
    addons: [],
    photos: [],
    notes: "",
    acts: [],
    visits: [],
    ...overrides,
  };
}

export function mkLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: "1",
    name: "Pat Rivera",
    phone: "555-0100",
    source: "web",
    tags: [],
    stage: "won",
    age: 0,
    job: "",
    last: "",
    ...overrides,
  };
}

export function mkTech(overrides: Partial<Tech> = {}): Tech {
  return {
    id: "1",
    name: "Mike Rivera",
    initials: "MR",
    color: "#123456",
    skills: [],
    wage: 40,
    ...overrides,
  };
}

export function mkInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: "inv-1",
    num: "INV-1",
    jobId: null,
    leadId: "1",
    cust: "Pat Rivera",
    phone: "555-0100",
    title: "Job",
    lines: [],
    total: 0,
    depPaid: 0,
    payments: [],
    status: "open",
    age: 0,
    archived: false,
    ...overrides,
  };
}

export function mkEntry(overrides: Partial<TimeEntry> = {}): TimeEntry {
  return {
    id: "entry-1",
    techId: "1",
    minutes: null,
    date: "2026-07-01",
    // REGULAR time by default. Job rows are costing: they run beside the shift and add no paid
    // hours, so a job-kind default made every hours assertion in the suite total zero.
    kind: "shop",
    jobId: null,
    start: "08:00",
    end: "12:00",
    note: "",
    src: "manual",
    status: "draft",
    ...overrides,
  };
}
