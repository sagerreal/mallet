import { describe, it, expect } from "vitest";
import {
  toQboInvoice,
  NO_AMOUNT,
  NO_INVOICE_ITEM,
  TAX_EXCEEDS_TOTAL,
  type SyncableInvoice,
} from "./invoice-mapping";

const ITEM = "14";
const CUSTOMER = "qbo-7";

const invoice = (over: Partial<SyncableInvoice> = {}): SyncableInvoice => ({
  id: "inv-1",
  num: "INV-1001",
  title: "Water heater replacement",
  // $1,100.00 charged, of which $88.55 is tax — so $1,011.45 is the net.
  totalCents: 110_000,
  taxCents: 8_855,
  sentAt: new Date(2026, 6, 25, 14, 0),
  dueAt: new Date(2026, 7, 1, 14, 0),
  ...over,
});

describe("toQboInvoice — the tax arithmetic", () => {
  /**
   * THE bug this mapping exists to avoid. QuickBooks computes an invoice total as
   * `Σ(lines) + TxnTaxDetail.TotalTax`, while Elas's `total` is TAX-INCLUSIVE. Sending the full
   * total as the line amount AND the tax would charge the tax twice — $1,188.55 on an invoice the
   * customer agreed at $1,100.
   */
  it("sends the PRE-TAX amount as the line, so QuickBooks does not tax it twice", () => {
    const r = toQboInvoice(invoice(), CUSTOMER, ITEM);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.netAmount).toBe(1011.45);
    expect(r.value.totalTax).toBe(88.55);
    // The reconstruction QuickBooks will perform.
    expect(r.value.netAmount + r.value.totalTax).toBeCloseTo(1100, 2);
  });

  it("converts integer cents to decimal dollars without a float artefact", () => {
    const r = toQboInvoice(invoice({ totalCents: 10, taxCents: 1 }), CUSTOMER, ITEM);
    expect(r.ok && r.value.netAmount).toBe(0.09);
    expect(r.ok && r.value.totalTax).toBe(0.01);
  });

  it("sends no tax when none was charged", () => {
    const r = toQboInvoice(invoice({ taxCents: 0 }), CUSTOMER, ITEM);
    expect(r.ok && r.value.totalTax).toBe(0);
    expect(r.ok && r.value.netAmount).toBe(1100);
  });

  // Defence in depth: the domain and a Postgres check both enforce this upstream, but this
  // function turns money into somebody's books and must not rely on that.
  it("refuses a tax that does not fit inside the total", () => {
    const r = toQboInvoice(invoice({ totalCents: 100, taxCents: 101 }), CUSTOMER, ITEM);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe(TAX_EXCEEDS_TOTAL);
  });

  it("allows an invoice that is entirely tax", () => {
    const r = toQboInvoice(invoice({ totalCents: 100, taxCents: 100 }), CUSTOMER, ITEM);
    expect(r.ok && r.value.netAmount).toBe(0);
    expect(r.ok && r.value.totalTax).toBe(1);
  });
});

describe("toQboInvoice — refusals", () => {
  it("refuses when no QuickBooks item has been chosen", () => {
    const r = toQboInvoice(invoice(), CUSTOMER, null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe(NO_INVOICE_ITEM);
  });

  // A zero invoice is not a financial fact; pushing one records a mistake rather than a sale.
  it("refuses a zero-amount invoice", () => {
    const r = toQboInvoice(invoice({ totalCents: 0, taxCents: 0 }), CUSTOMER, ITEM);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe(NO_AMOUNT);
  });

  it("refuses a negative total", () => {
    expect(toQboInvoice(invoice({ totalCents: -1, taxCents: 0 }), CUSTOMER, ITEM).ok).toBe(false);
  });
});

describe("toQboInvoice — dates and labels", () => {
  /**
   * The date the invoice was ISSUED, not the day the push happened: a sync delayed by a failed
   * cron must not land the revenue in the wrong accounting period.
   */
  it("dates the invoice from when it was sent", () => {
    const r = toQboInvoice(invoice(), CUSTOMER, ITEM);
    expect(r.ok && r.value.txnDate).toBe("2026-07-25");
    expect(r.ok && r.value.dueDate).toBe("2026-08-01");
  });

  it("omits a due date it does not have", () => {
    const r = toQboInvoice(invoice({ dueAt: null }), CUSTOMER, ITEM);
    expect(r.ok && r.value.dueDate).toBeNull();
  });

  it("carries Elas's invoice number so the two can be reconciled by eye", () => {
    const r = toQboInvoice(invoice(), CUSTOMER, ITEM);
    expect(r.ok && r.value.docNumber).toBe("INV-1001");
  });

  it("falls back to the invoice number when there is no title", () => {
    expect(toQboInvoice(invoice({ title: null }), CUSTOMER, ITEM).ok &&
      toQboInvoice(invoice({ title: null }), CUSTOMER, ITEM)).toMatchObject({
      value: { description: "Invoice INV-1001" },
    });
    expect(toQboInvoice(invoice({ title: "   " }), CUSTOMER, ITEM)).toMatchObject({
      value: { description: "Invoice INV-1001" },
    });
  });
});
