import { describe, it, expect } from "vitest";
import {
  asInvoiceId,
  asOrgId,
  asLeadId,
  asJobId,
  asUserId,
  money,
  zeroMoney,
  isOk,
} from "@mallet/shared/types";
import { Invoice } from "../domain/invoice";
import { InvoiceLine } from "../domain/invoice-line";
import { Payment } from "../domain/payment";
import { fieldInvoiceDTO, toFieldInvoiceDTO } from "./field-invoice-dto";

const now = new Date("2026-08-01T12:00:00Z");

const lineOf = (id: string, rateCents: number, costCents: number, position: number): InvoiceLine => {
  const r = InvoiceLine.create({
    id,
    sourceJobLineId: null,
    description: "Water heater — 50 gal",
    quantity: 1,
    rate: money(rateCents),
    cost: money(costCents),
    position,
  });
  if (!isOk(r)) throw new Error("test line failed to build");
  return r.value;
};

const paymentOf = (): Payment => {
  const r = Payment.create({
    id: "99999999-9999-4999-8999-999999999999",
    amount: money(20_000),
    method: "cash",
    idempotencyKey: "idem-key-1234",
    externalId: null,
    recordedByUserId: asUserId("44444444-4444-4444-8444-444444444444"),
    receivedAt: now,
  });
  if (!isOk(r)) throw new Error("test payment failed to build");
  return r.value;
};

const invoice = (): Invoice => {
  const r = Invoice.create({
    id: asInvoiceId("11111111-1111-4111-8111-111111111111"),
    orgId: asOrgId("22222222-2222-2222-2222-222222222222"),
    num: "INV-1000",
    sourceJobId: asJobId("66666666-6666-4666-8666-666666666666"),
    scopeJobId: null,
    leadId: asLeadId("33333333-3333-4333-8333-333333333333"),
    title: "Water heater",
    status: "partial",
    total: money(84_000),
    taxBps: 700,
    tax: money(5_495),
    depositPaid: money(10_000),
    amountPaid: money(20_000),
    payments: [paymentOf()],
    lines: [lineOf("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", 78_505, 41_000, 0)],
    termsDays: 7,
    poNumber: "PO-4471",
    publicToken: "f".repeat(64),
    sentAt: now,
    dueAt: now,
    createdAt: now,
    updatedAt: now,
  });
  if (!isOk(r)) throw new Error("test invoice failed to build");
  return r.value;
};

/** The three document facts resolved beside the invoice: who was billed, where, and when. */
const PARTY = {
  customerName: "Dana Ruiz",
  serviceAddress: "18 Aspen Ct, Dublin, CA 94568",
  serviceAt: new Date("2026-08-03T16:20:00Z"),
};

describe("fieldInvoiceDTO — what may cross to a tech's device", () => {
  it("emits EXACTLY this key set and nothing else", () => {
    // The key-set assertion is the whole point of this file. It is the only thing standing between
    // a future refactor that "just reuses invoiceDTO" and every technician in the shop holding a
    // permanent unauthenticated pay-link for their customers' invoices.
    const dto = toFieldInvoiceDTO(invoice(), PARTY, true);
    expect(Object.keys(dto).sort()).toEqual(
      [
        "amountPaid",
        "createdAt",
        "customerName",
        "depositPaid",
        // The discount AMOUNT (not the rate — taxBps' sibling discBps stays office-only). The
        // close-out sheet renders the same <InvoiceDocument> as the customer's copy, and a total
        // below the sum of its lines with nothing explaining it reads as an arithmetic error.
        "discount",
        "due",
        "dueAt",
        "id",
        "leadId",
        "lines",
        "num",
        "payments",
        "scopeJobId",
        "sentAt",
        "serviceAddress",
        "serviceAt",
        "sourceJobId",
        "status",
        "tax",
        "termsDays",
        "title",
        "total",
      ].sort(),
    );
  });

  it("never carries cost, the pay-link credential, or the office-only fields", () => {
    const dto = toFieldInvoiceDTO(invoice(), PARTY, true) as unknown as Record<string, unknown>;
    for (const forbidden of [
      "cost",
      "publicToken",
      "publicUrl",
      "authorization",
      "poNumber",
      "taxBps",
      "followUpOn",
      "followUpStage",
    ]) {
      expect(dto[forbidden], `${forbidden} must never reach a tech`).toBeUndefined();
    }
  });

  it("strips cost from every LINE, unconditionally, at both settings", () => {
    for (const seesPrice of [true, false]) {
      const dto = toFieldInvoiceDTO(invoice(), PARTY, seesPrice);
      for (const line of dto.lines) {
        expect(Object.keys(line).sort()).toEqual(
          ["description", "id", "position", "quantity", "rate", "taxable"].sort(),
        );
      }
    }
  });

  it("passes its own schema at both settings", () => {
    for (const seesPrice of [true, false]) {
      expect(() => fieldInvoiceDTO.parse(toFieldInvoiceDTO(invoice(), PARTY, seesPrice))).not.toThrow();
    }
  });
});

describe("fieldInvoiceDTO — the price-visibility rule", () => {
  it("ALWAYS shows the amounts needed to collect, even when the shop hides prices", () => {
    // You cannot collect $840 without displaying "$840". In a techSeesPrice=false shop the
    // technician sees the balance and no per-line breakdown — that is the rule, not a leak.
    const hidden = toFieldInvoiceDTO(invoice(), PARTY, false);
    expect(hidden.total.cents).toBe(84_000);
    expect(hidden.due.cents).toBe(54_000); // 84000 − 10000 deposit − 20000 paid
    expect(hidden.depositPaid.cents).toBe(10_000);
    expect(hidden.amountPaid.cents).toBe(20_000);
    expect(hidden.tax.cents).toBe(5_495);
    expect(hidden.payments[0]?.amount.cents).toBe(20_000);
  });

  it("nulls line rate when the shop hides prices — null, never a fabricated 0", () => {
    const hidden = toFieldInvoiceDTO(invoice(), PARTY, false);
    // The client must be able to tell "hidden from you" from "free"; a 0 here would render as $0.00
    // on a customer-facing bill line.
    expect(hidden.lines[0]?.rate).toBeNull();

    const shown = toFieldInvoiceDTO(invoice(), PARTY, true);
    expect(shown.lines[0]?.rate).toEqual({ cents: 78_505, currency: "USD" });
  });
});
