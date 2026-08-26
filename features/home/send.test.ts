// @vitest-environment jsdom
/**
 * features/home/send.test.ts
 * THE TWO THINGS AN APPROVED SEND MUST GET RIGHT, both asserted against the shape the app really
 * hands them — a queue item built by `useOkQueue` from `quoting.followUps`, whose `estimate` is a
 * CAST STUB with no `fu` on it (use-ok-queue.ts:95). Fixtures shaped like the store's full
 * `Estimate` hid both of the bugs below.
 *
 * 1. The dedupe key must distinguish two honest reminders. Keyed on the follow-up stage it did
 *    not: the stub's absent `fu` read as stage 0 forever, so every later nudge about the same
 *    quote deduped against the first — "✓ sent" over a text that never went.
 * 2. The commit must not throw. `item.estimate.fu.stage` was a TypeError on that same stub,
 *    raised before the dispatch, so the send died on the click.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { commitOkSend, okSendKey } from "./send";
import type { OkItem } from "./derive";
import type { Estimate, Invoice, Lead } from "@/lib/store/types";

const store = vi.hoisted(() => ({
  addLeadNote: vi.fn(() => ({ id: "note-1" })),
  removeLeadNote: vi.fn(),
  updateEstimate: vi.fn(),
  updateInvoice: vi.fn(),
  updateLead: vi.fn(),
  moveLeadStage: vi.fn(),
}));

vi.mock("@/lib/store/app-store", () => ({
  useAppStore: { getState: () => store },
}));

// ---- fixtures ---------------------------------------------------------------

const lead: Lead = {
  id: "l1", name: "Maria Ortiz", phone: "555-0100", source: "web", tags: [], stage: "Quote Sent",
  age: 3, job: "Water heater leaking", last: "",
};

/**
 * EXACTLY what useOkQueue pushes: four fields, cast. No `fu`, no `status`, no `leadId`.
 * If this fixture ever gains `fu`, the regression it guards stops being guarded.
 */
const queueEstimateStub = { id: "e1", num: "EST-1001", cachedTotal: 2890, lines: [] } as unknown as Estimate;

const fullEstimate: Estimate = {
  id: "e1", num: "EST-1001", leadId: "l1", title: "Water heater replacement",
  status: "sent", age: 4, viewed: true, fu: { on: true, stage: 2 }, lines: [],
};

const invoice = (fu?: { on: boolean; stage: number }): Invoice => ({
  id: "i1", num: "INV-2001", jobId: "j1", leadId: "l1", cust: "Maria Ortiz", phone: "555-0100",
  title: "Water heater replacement", lines: [], total: 1325, depPaid: 0, payments: [],
  status: "sent", age: 30, archived: false, ...(fu ? { fu } : {}),
});

const quoteItem = (estimate: Estimate): OkItem => ({
  key: "okq-e1", kind: "quote-viewed", lead, estimate,
  value: 2890, situation: "read the $2,890 quote", editLabel: "Change",
});

const billItem = (inv: Invoice): OkItem => ({
  key: "oki-i1", kind: "invoice-overdue", lead, invoice: inv,
  value: 1325, situation: "30d past due", editLabel: "Change",
});

/** The shop's own day, formed the way okSendKey forms it. */
const today = (): string => {
  const d = new Date();
  return `${d.getFullYear()}${`${d.getMonth() + 1}`.padStart(2, "0")}${`${d.getDate()}`.padStart(2, "0")}`;
};

beforeEach(() => {
  for (const fn of Object.values(store)) fn.mockClear();
});

// ---- the key ----------------------------------------------------------------

describe("okSendKey", () => {
  it("survives the real queue item — a stub with no follow-up state on it", () => {
    expect(() => okSendKey(quoteItem(queueEstimateStub))).not.toThrow();
    expect(okSendKey(quoteItem(queueEstimateStub))).toBe(`okq-e1-d${today()}`);
  });

  it("is the record plus the shop's own day", () => {
    expect(okSendKey(quoteItem(fullEstimate))).toMatch(/^okq-e1-d\d{8}$/);
  });

  it("is stable within the day, so a double-click is one text", () => {
    expect(okSendKey(quoteItem(queueEstimateStub))).toBe(okSendKey(quoteItem(queueEstimateStub)));
  });

  it("does NOT vary with follow-up stage — the stage is not a fact these items carry", () => {
    expect(okSendKey(quoteItem(fullEstimate))).toBe(okSendKey(quoteItem(queueEstimateStub)));
  });

  it("keys a bill off its own record, same shape", () => {
    expect(okSendKey(billItem(invoice({ on: true, stage: 2 })))).toBe(`oki-i1-d${today()}`);
  });

  it("clears the server's 8-character floor and its 64-character ceiling", () => {
    const key = okSendKey(quoteItem(queueEstimateStub));
    expect(key.length).toBeGreaterThanOrEqual(8);
    expect(key.length).toBeLessThanOrEqual(64);
  });
});

// ---- the commit -------------------------------------------------------------

describe("commitOkSend", () => {
  it("commits a real queue item without throwing, and the note IS the commit", () => {
    const undo = commitOkSend(quoteItem(queueEstimateStub), "Hi Maria — checking in.");

    expect(store.addLeadNote).toHaveBeenCalledTimes(1);
    // Nothing to advance: the record carries no follow-up state to bump.
    expect(store.updateEstimate).not.toHaveBeenCalled();

    undo();
    expect(store.removeLeadNote).toHaveBeenCalledWith("l1", "note-1");
    // …and nothing to restore, so undo invents no state the record never had.
    expect(store.updateEstimate).not.toHaveBeenCalled();
  });

  it("still advances the follow-up when the record actually has one", () => {
    const undo = commitOkSend(quoteItem(fullEstimate), "Hi Maria — checking in.");
    expect(store.updateEstimate).toHaveBeenCalledWith("e1", { fu: { on: true, stage: 3 } });

    undo();
    expect(store.updateEstimate).toHaveBeenLastCalledWith("e1", { fu: { on: true, stage: 2 } });
  });

  it("bumps a bill's reminder count, and leaves alone one that has none", () => {
    commitOkSend(billItem(invoice({ on: true, stage: 1 })), "nudge");
    expect(store.updateInvoice).toHaveBeenCalledWith("i1", { fu: { on: true, stage: 2 } });

    store.updateInvoice.mockClear();
    commitOkSend(billItem(invoice()), "nudge");
    expect(store.updateInvoice).not.toHaveBeenCalled();
  });
});
