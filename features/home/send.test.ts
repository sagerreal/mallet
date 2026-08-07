// @vitest-environment jsdom
/**
 * features/home/send.test.ts
 * The dedupe key an approved reminder carries. Two clicks on the same card must produce the SAME
 * key (the server collapses them into one text); a reminder sent after the record advanced a
 * follow-up stage must produce a DIFFERENT one, or the second nudge would be silently swallowed.
 */

import { describe, expect, it } from "vitest";
import { okSendKey } from "./send";
import type { OkItem } from "./derive";
import type { Estimate, Invoice, Lead } from "@/lib/store/types";

const lead: Lead = {
  id: "l1", name: "Maria Ortiz", phone: "555-0100", source: "web", stage: "Quote Sent",
  age: 3, job: "Water heater leaking", last: "",
};

const estimate = (stage: number): Estimate => ({
  id: "e1", num: "EST-1001", leadId: "l1", title: "Water heater replacement",
  status: "sent", age: 4, viewed: true, fu: { on: true, stage }, lines: [],
});

const invoice = (fu?: { on: boolean; stage: number }): Invoice => ({
  id: "i1", num: "INV-2001", jobId: "j1", leadId: "l1", cust: "Maria Ortiz", phone: "555-0100",
  title: "Water heater replacement", lines: [], total: 1325, depPaid: 0, payments: [],
  status: "sent", age: 30, archived: false, ...(fu ? { fu } : {}),
});

const quoteItem = (stage: number): OkItem => ({
  key: "okq-e1", kind: "quote-viewed", lead, estimate: estimate(stage),
  value: 1325, situation: "read her quote", editLabel: "Change",
});

describe("okSendKey", () => {
  it("is stable for the same record at the same follow-up stage", () => {
    expect(okSendKey(quoteItem(0))).toBe(okSendKey(quoteItem(0)));
  });

  it("names the follow-up this send IS — stage 0 sends follow-up 1", () => {
    expect(okSendKey(quoteItem(0))).toBe("okq-e1-fu1");
  });

  it("changes once the record has advanced a stage, so a real second nudge goes out", () => {
    expect(okSendKey(quoteItem(1))).not.toBe(okSendKey(quoteItem(0)));
    expect(okSendKey(quoteItem(1))).toBe("okq-e1-fu2");
  });

  it("keys an overdue invoice off its own follow-up state", () => {
    const item: OkItem = {
      key: "okq-i1", kind: "invoice-overdue", lead, invoice: invoice({ on: true, stage: 2 }),
      value: 1325, situation: "30 days overdue", editLabel: "Soften it",
    };
    expect(okSendKey(item)).toBe("okq-i1-fu3");
  });

  it("treats a bill with no follow-up state yet as stage 0", () => {
    const item: OkItem = {
      key: "okq-i1", kind: "invoice-overdue", lead, invoice: invoice(),
      value: 1325, situation: "30 days overdue", editLabel: "Soften it",
    };
    expect(okSendKey(item)).toBe("okq-i1-fu1");
  });

  it("keys a reply or a new lead off the item alone — there is no follow-up ladder", () => {
    const item: OkItem = {
      key: "okq-l1", kind: "reply", lead, value: 0, situation: "texted back", editLabel: "Change",
    };
    expect(okSendKey(item)).toBe("okq-l1-fu1");
  });
});
