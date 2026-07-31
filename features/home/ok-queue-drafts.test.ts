import { describe, it, expect } from "vitest";
import { draftFor } from "./drafts";
import type { OkItem } from "./derive";
import type { Invoice, Lead, Estimate } from "@/lib/store/types";

/**
 * What the drafted message actually says.
 *
 * Owen read one on screen: "Just a nudge that invoice () is still open." The template names the
 * invoice and the amount off `item.invoice` — and the queue, once it started fetching from the
 * database, stopped attaching it. So the reminder could not say which bill it was about, and the
 * owner would have sent it.
 *
 * A draft with a hole in it is worse than no draft: it is pre-written, it looks finished, and the
 * Send button is right there.
 */

const lead = (over: Partial<Lead> = {}): Lead =>
  ({ id: "lead-1", name: "Jill Vance", phone: "+19255550100", stage: "", age: 0, job: "",
     last: "", source: "", archived: false, ...over }) as Lead;

const overdueItem = (invoice?: Partial<Invoice>): OkItem =>
  ({
    key: "oki-1",
    kind: "invoice-overdue",
    lead: lead(),
    invoice: invoice
      ? ({ id: "inv-1", num: "INV-2042", total: 640, depPaid: 0, payments: [],
           paidTotal: 400, lines: [], status: "sent", age: 30, archived: false,
           ...invoice } as Invoice)
      : undefined,
    value: 240,
    situation: "owes $240 — 30d past due",
    editLabel: "Change",
  }) as OkItem;

const quoteItem = (estimate?: Partial<Estimate>): OkItem =>
  ({
    key: "okq-1",
    kind: "quote-viewed",
    lead: lead(),
    estimate: estimate
      ? ({ id: "est-1", num: "EST-1024", cachedTotal: 1175, lines: [], status: "sent",
           age: 13, archived: false, trash: false, ...estimate } as Estimate)
      : undefined,
    value: 1175,
    situation: "read the $1,175 quote",
    editLabel: "Change",
  }) as OkItem;

const ctx = { orgName: "Summit Plumbing & Drain", ownerFirst: "Owen" };

describe("the overdue reminder", () => {
  it("names the invoice", () => {
    expect(draftFor(overdueItem({}), ctx)).toContain("INV-2042");
  });

  it("says what is owed", () => {
    expect(draftFor(overdueItem({}), ctx)).toContain("$240");
  });

  // The exact text Owen saw.
  it("never reads 'invoice ()' — the hole this closes", () => {
    const text = draftFor(overdueItem({}), ctx);
    expect(text).not.toContain("invoice ()");
    expect(text).not.toContain("()");
  });
});

describe("the quote follow-up", () => {
  it("says what the quote was worth", () => {
    expect(draftFor(quoteItem({}), ctx)).toContain("$1,175");
  });

  it("leaves no empty bracket when the amount is unknown", () => {
    expect(draftFor(quoteItem(undefined), ctx)).not.toContain("()");
  });
});
