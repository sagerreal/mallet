/**
 * features/money/invoices-hydrator.test.ts
 * toStoreInvoice — the LIST row → store Invoice mapper behind every office page load.
 *
 * THE BUG THESE PIN. This mapper hard-coded `jobId: null` and left the balance to be
 * re-derived from a deposit and a payment history the summary DTO does not carry. Every
 * mutation stamped the job link and then invalidated the list, which refetched and nulled it
 * again — so the field close-out's done card oscillated between "✓ Job done $185 / Send to the
 * office to bill" and the take-payment branch, and the payment sheet, which finds the job's
 * invoice through that link, rendered an empty white sliver.
 *
 * There are TWO mappers for this one DTO (this one and dto-mapper's dtoInvoiceSummaryToStore);
 * the last test holds them to the same answer, because a divergence between copies is exactly
 * what shipped this class of bug twice.
 */

import { describe, it, expect } from "vitest";
import { toStoreInvoice } from "./invoices-hydrator";
import { dtoInvoiceSummaryToStore } from "@/lib/store/dto-mapper";
import { invDue, invPaid } from "@/lib/store/invoice-balance";

type SummaryDTO = Parameters<typeof toStoreInvoice>[0];

const summary = (over: Partial<SummaryDTO> = {}): SummaryDTO =>
  ({
    id: "inv-1",
    num: "INV-810",
    leadId: "lead-1",
    sourceJobId: "job-1",
    customerName: "Dana Alvarez",
    customerPhone: "+15550001234",
    title: "Water heater",
    status: "sent",
    total: { cents: 18_500, currency: "USD" },
    due: { cents: 18_500, currency: "USD" },
    dueAt: null,
    followUpOn: false,
    followUpStage: 0,
    createdAt: "2026-07-30T09:00:00.000Z",
    ...over,
  }) as SummaryDTO;

describe("toStoreInvoice — the job link survives the list", () => {
  it("carries sourceJobId onto the store record's jobId", () => {
    const dto = summary();
    expect(toStoreInvoice(dto).jobId).toBe(dto.sourceJobId);
  });

  it("keeps null for a lead-tied (manual) invoice, which genuinely has no job", () => {
    expect(toStoreInvoice(summary({ sourceJobId: null })).jobId).toBeNull();
  });
});

describe("toStoreInvoice — the balance is the server's, not a re-derivation", () => {
  it("owes the server's due on a fully unpaid invoice", () => {
    expect(invDue(toStoreInvoice(summary()))).toBe(185);
  });

  // The oscillating AMOUNT: the summary carries no deposit and no payments, so re-deriving the
  // balance from the record's own parts reported the whole $185 as owed on an invoice with a
  // $100 deposit already credited — until a mutation reconcile loaded the real record and said
  // $85, and the next refetch said $185 again.
  it("owes only the balance on an invoice with a deposit already credited", () => {
    const dto = summary({ due: { cents: 8_500, currency: "USD" } });
    const inv = toStoreInvoice(dto);
    expect(invDue(inv)).toBe(dto.due.cents / 100);
    expect(invPaid(inv)).toBe(100);
    // The deposit field must NOT be used to smuggle the balance in — a payment reported as a
    // deposit makes the deposit line on the invoice's face lie.
    expect(inv.depPaid).toBe(0);
  });

  it("owes nothing on a settled invoice", () => {
    expect(invDue(toStoreInvoice(summary({ due: { cents: 0, currency: "USD" } })))).toBe(0);
  });

  it("is marked partial, so a surface deciding from lines/history still fetches the record", () => {
    expect(toStoreInvoice(summary()).partial).toBe(true);
    expect(toStoreInvoice(summary()).lines).toEqual([]);
  });
});

describe("the two mappers for this DTO agree", () => {
  it("gives the same job link, balance and paid figure as dtoInvoiceSummaryToStore", () => {
    const dto = summary({ due: { cents: 8_500, currency: "USD" } });
    const fromHydrator = toStoreInvoice(dto);
    const fromMapper = dtoInvoiceSummaryToStore(dto, { cust: "", phone: "", email: undefined });
    expect(fromHydrator.jobId).toBe(fromMapper.jobId);
    expect(invDue(fromHydrator)).toBe(invDue(fromMapper));
    expect(invPaid(fromHydrator)).toBe(invPaid(fromMapper));
  });
});
