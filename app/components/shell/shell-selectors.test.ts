/**
 * components/shell/shell-selectors.test.ts
 * Unit tests for the pure shell badge-count selector functions.
 * These are extracted from the inline store subscriptions so they can be tested
 * without mounting any React component.
 */

import { describe, it, expect } from "vitest";
import {
  selectOpenTaskCount,
  selectCustomerCount,
  selectJobsCount,
  selectUnscheduledCount,
  selectMoneyCount,
} from "./shell-selectors";
import type { Task, Lead, Job, Invoice } from "@/lib/store/types";

// ---- minimal fixtures -------------------------------------------------------

function mkTask(overrides: Partial<Task> = {}): Task {
  return { id: "t1", t: "Do something", due: null, leadId: null, ...overrides };
}

function mkLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: "l1", name: "Pat", phone: "555", source: "web", tags: [],
    stage: "won", age: 0, job: "", last: "",
    ...overrides,
  };
}

function mkJob(overrides: Partial<Job> = {}): Job {
  return {
    id: "j1", leadId: "l1", svc: "plumbing", origin: "office",
    title: "Fix leak", addr: "1 Main", phone: "555",
    status: "scheduled", archived: false,
    lines: [], addons: [], photos: [], notes: "", acts: [], visits: [],
    ...overrides,
  };
}

function mkInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: "inv1", num: "INV-1", jobId: null, leadId: "l1",
    cust: "Pat", phone: "555", title: "Fix leak",
    lines: [], total: 0, depPaid: 0, payments: [],
    status: "open", age: 0, archived: false,
    ...overrides,
  };
}

// ---- selectOpenTaskCount ----------------------------------------------------

describe("selectOpenTaskCount", () => {
  it("counts only tasks where done is falsy", () => {
    const tasks = [
      mkTask({ id: "1", done: false }),
      mkTask({ id: "2", done: true }),
      mkTask({ id: "3" }), // done undefined → falsy → counts
    ];
    expect(selectOpenTaskCount({ tasks })).toBe(2);
  });

  it("returns 0 for an empty list", () => {
    expect(selectOpenTaskCount({ tasks: [] })).toBe(0);
  });

  it("returns 0 when all tasks are done", () => {
    const tasks = [mkTask({ done: true }), mkTask({ id: "2", done: true })];
    expect(selectOpenTaskCount({ tasks })).toBe(0);
  });
});

// ---- selectCustomerCount ----------------------------------------------------

describe("selectCustomerCount", () => {
  it("counts only non-archived leads", () => {
    const leads = [
      mkLead({ id: "1", archived: false }),
      mkLead({ id: "2", archived: true }),
      mkLead({ id: "3" }), // archived undefined → not archived → counts
    ];
    expect(selectCustomerCount({ leads })).toBe(2);
  });

  it("returns 0 when all leads are archived", () => {
    const leads = [mkLead({ archived: true }), mkLead({ id: "2", archived: true })];
    expect(selectCustomerCount({ leads })).toBe(0);
  });
});

// ---- selectJobsCount --------------------------------------------------------

describe("selectJobsCount", () => {
  it("counts non-archived jobs that are not done", () => {
    const jobs = [
      mkJob({ id: "1", archived: false, status: "scheduled" }),   // counts
      mkJob({ id: "2", archived: false, status: "done" }),         // excluded (done)
      mkJob({ id: "3", archived: true,  status: "scheduled" }),    // excluded (archived)
      mkJob({ id: "4", archived: false, status: "unscheduled" }), // counts
    ];
    expect(selectJobsCount({ jobs })).toBe(2);
  });

  it("returns 0 for an empty list", () => {
    expect(selectJobsCount({ jobs: [] })).toBe(0);
  });
});

// ---- selectUnscheduledCount -------------------------------------------------

describe("selectUnscheduledCount", () => {
  it("counts only non-archived unscheduled jobs", () => {
    const jobs = [
      mkJob({ id: "1", archived: false, status: "unscheduled" }),  // counts
      mkJob({ id: "2", archived: false, status: "scheduled" }),    // excluded
      mkJob({ id: "3", archived: true,  status: "unscheduled" }), // excluded (archived)
    ];
    expect(selectUnscheduledCount({ jobs })).toBe(1);
  });

  it("returns 0 when no unscheduled jobs exist", () => {
    const jobs = [mkJob({ status: "scheduled" }), mkJob({ id: "2", status: "done" })];
    expect(selectUnscheduledCount({ jobs })).toBe(0);
  });
});

// ---- selectMoneyCount -------------------------------------------------------

describe("selectMoneyCount", () => {
  it("counts only non-archived invoices with status sent or partial", () => {
    const invoices = [
      mkInvoice({ id: "1", archived: false, status: "sent" }),     // counts
      mkInvoice({ id: "2", archived: false, status: "partial" }),  // counts
      mkInvoice({ id: "3", archived: false, status: "open" }),     // excluded (open)
      mkInvoice({ id: "4", archived: false, status: "paid" }),     // excluded (paid)
      mkInvoice({ id: "5", archived: true,  status: "sent" }),     // excluded (archived)
    ];
    expect(selectMoneyCount({ invoices })).toBe(2);
  });

  it("returns 0 when no outstanding invoices exist", () => {
    const invoices = [mkInvoice({ status: "paid" }), mkInvoice({ id: "2", status: "draft" })];
    expect(selectMoneyCount({ invoices })).toBe(0);
  });

  it("returns 0 for an empty list", () => {
    expect(selectMoneyCount({ invoices: [] })).toBe(0);
  });
});
