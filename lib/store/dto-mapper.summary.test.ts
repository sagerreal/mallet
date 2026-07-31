import { describe, it, expect } from "vitest";
import {
  dtoInvoiceSummaryToStore,
  dtoEstimateSummaryToStore,
  type InvoiceSummaryDTO,
  type EstimateSummaryDTO,
} from "./dto-mapper";
import { invPaid, invDue } from "@/features/money/money-derive";
import { estTotal } from "@/lib/estimates";

/**
 * THE CRASH. Money and Pipeline both rendered "Something went wrong" in production.
 *
 * Both pages fed a LIST row into the mapper written for the FULL record. A summary carries what a
 * row needs — who, what, how much — and not the lines, payments or tax. The full mapper read
 * `dto.tax.cents` and `dto.lines.map`, found undefined, and threw during render.
 *
 * TypeScript would have caught it. Both call sites had an `as never` cast that silenced it. The
 * mappers below are typed to the summary shapes so the same mistake cannot be made silently, and
 * these tests pin the behaviour that made the pages usable rather than merely non-crashing:
 * a ledger row still knows its balance, and a rail card still knows its total.
 */

const invoiceSummary = (over: Partial<InvoiceSummaryDTO> = {}): InvoiceSummaryDTO =>
  ({
    id: "inv-1",
    num: "INV-2042",
    leadId: "lead-1",
    customerName: "Zsofia Quennell",
    title: "Sewer camera",
    status: "sent",
    total: { cents: 64000, currency: "USD" },
    due: { cents: 24000, currency: "USD" },
    dueAt: null,
    createdAt: "2026-07-01T09:00:00.000Z",
    ...over,
  }) as InvoiceSummaryDTO;

const estimateSummary = (over: Partial<EstimateSummaryDTO> = {}): EstimateSummaryDTO =>
  ({
    id: "est-1",
    num: "EST-1",
    leadId: "lead-1",
    customerName: "Zsofia Quennell",
    title: "Repipe",
    status: "sent",
    total: { cents: 29722, currency: "USD" },
    createdAt: "2026-07-01T09:00:00.000Z",
    publicToken: null,
    publicUrl: null,
    changeRequestedAt: null,
    recommendedTier: null,
    acceptedTier: null,
    tierNames: null,
    termsSnapshot: null,
    signed: false,
    ...over,
  }) as EstimateSummaryDTO;

describe("invoice list row → store", () => {
  it("does not throw on a row that carries no lines, payments or tax", () => {
    expect(() => dtoInvoiceSummaryToStore(invoiceSummary(), { cust: "—", phone: "", email: "" }))
      .not.toThrow();
  });

  // The part that matters after "it renders": a ledger whose every row reads as fully unpaid is
  // still wrong, just not loudly. The server computed the balance; this keeps it.
  it("keeps the balance the server computed", () => {
    const inv = dtoInvoiceSummaryToStore(invoiceSummary(), { cust: "—", phone: "", email: "" });
    expect(invDue(inv)).toBe(240);
    expect(invPaid(inv)).toBe(400); // 640 total − 240 still owed
  });

  it("uses the server's customer name — the store's copy may not be loaded", () => {
    const inv = dtoInvoiceSummaryToStore(invoiceSummary(), { cust: "—", phone: "", email: "" });
    expect(inv.cust).toBe("Zsofia Quennell");
  });

  it("treats a fully settled invoice as owing nothing", () => {
    const inv = dtoInvoiceSummaryToStore(
      invoiceSummary({ due: { cents: 0, currency: "USD" } }),
      { cust: "—", phone: "", email: "" },
    );
    expect(invDue(inv)).toBe(0);
    expect(invPaid(inv)).toBe(640);
  });
});

describe("estimate list row → store", () => {
  it("does not throw on a row that carries no lines", () => {
    expect(() => dtoEstimateSummaryToStore(estimateSummary(), { on: false, stage: 0 })).not.toThrow();
  });

  // estTotal reads cachedTotal when there are no lines. Without it every rail card would show $0,
  // which is the shape of the bug that once put "$0" on the Pipeline strip.
  it("keeps the total the domain computed, with no lines loaded", () => {
    const est = dtoEstimateSummaryToStore(estimateSummary(), { on: false, stage: 0 });
    expect(est.lines).toEqual([]);
    expect(estTotal(est)).toBe(297.22);
  });

  it("marks anything past draft as seen by the customer", () => {
    expect(dtoEstimateSummaryToStore(estimateSummary(), { on: false, stage: 0 }).viewed).toBe(true);
    expect(
      dtoEstimateSummaryToStore(estimateSummary({ status: "draft" }), { on: false, stage: 0 }).viewed,
    ).toBe(false);
  });
});
