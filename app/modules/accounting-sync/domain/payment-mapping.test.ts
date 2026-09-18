import { describe, it, expect } from "vitest";
import {
  toQboPayment,
  NO_AMOUNT,
  INVOICE_NOT_IN_QBO,
  type SyncablePayment,
} from "./payment-mapping";

const CUSTOMER = "qbo-cust-3";
const INVOICE = "qbo-inv-9";

const payment = (over: Partial<SyncablePayment> = {}): SyncablePayment => ({
  id: "pay-1",
  invoiceId: "inv-1",
  amountCents: 110_000,
  receivedAt: new Date(2026, 6, 26, 9, 30),
  ...over,
});

describe("toQboPayment", () => {
  it("links the payment to the invoice it settles", () => {
    const r = toQboPayment(payment(), CUSTOMER, INVOICE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual({
      customerId: CUSTOMER,
      invoiceQboId: INVOICE,
      txnDate: "2026-07-26",
      amount: 1100,
    });
  });

  /**
   * The refusal that matters. QuickBooks accepts a payment with no LinkedTxn and files it as an
   * unapplied CREDIT on the customer: the money appears, the invoice still reads open, and somebody
   * has to match them by hand. Refusing is the honest answer — the shop has to send the invoice
   * first.
   */
  it("refuses when the invoice is not in QuickBooks yet", () => {
    const r = toQboPayment(payment(), CUSTOMER, null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe(INVOICE_NOT_IN_QBO);
  });

  it("refuses a zero or negative payment", () => {
    expect(toQboPayment(payment({ amountCents: 0 }), CUSTOMER, INVOICE).ok).toBe(false);
    const r = toQboPayment(payment({ amountCents: -1 }), CUSTOMER, INVOICE);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe(NO_AMOUNT);
  });

  it("converts cents to dollars without a float artefact", () => {
    expect(toQboPayment(payment({ amountCents: 1 }), CUSTOMER, INVOICE)).toMatchObject({
      value: { amount: 0.01 },
    });
    expect(toQboPayment(payment({ amountCents: 8_855 }), CUSTOMER, INVOICE)).toMatchObject({
      value: { amount: 88.55 },
    });
  });

  // Dated when the money arrived, not when the push ran — a delayed sync must not move a receipt
  // into the wrong accounting period.
  it("dates the payment from when it was received", () => {
    const r = toQboPayment(payment({ receivedAt: new Date(2026, 0, 3, 23, 55) }), CUSTOMER, INVOICE);
    expect(r.ok && r.value.txnDate).toBe("2026-01-03");
  });

  // Part-payments are ordinary; each is its own QuickBooks payment against the same invoice.
  it("allows a part payment", () => {
    const r = toQboPayment(payment({ amountCents: 50_000 }), CUSTOMER, INVOICE);
    expect(r.ok && r.value.amount).toBe(500);
  });
});
