import type { Result, ValidationError } from "@mallet/shared/types";
import { validation, ok, err } from "@mallet/shared/types";

/** A Mallet invoice, narrowed to what QuickBooks needs. All money in integer cents. */
export interface SyncableInvoice {
  readonly id: string;
  readonly num: string;
  readonly title: string | null;
  /** TAX-INCLUSIVE, as it is everywhere in Mallet. */
  readonly totalCents: number;
  /** How much of `totalCents` is tax. */
  readonly taxCents: number;
  readonly sentAt: Date | null;
  readonly dueAt: Date | null;
}

/** What we send to create a QuickBooks Invoice. Money in DOLLARS — QBO's API is decimal. */
export interface QboInvoiceInput {
  readonly customerId: string;
  readonly docNumber: string;
  readonly txnDate: string; // YYYY-MM-DD
  readonly dueDate: string | null;
  readonly itemId: string;
  readonly description: string;
  /** The PRE-TAX amount. QuickBooks adds `totalTax` to this to reach the invoice total. */
  readonly netAmount: number;
  readonly totalTax: number;
}

export const NO_AMOUNT = "invoice_has_no_amount";
export const NO_INVOICE_ITEM = "no_invoice_item";
export const TAX_EXCEEDS_TOTAL = "tax_exceeds_total";

/** Integer cents → decimal dollars, rounded so no float artefact reaches somebody's books. */
const dollars = (cents: number): number => Math.round(cents) / 100;

/** A Postgres `date` in local terms. Anchored at noon so neither DST edge can shift the day. */
const isoDate = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

/**
 * Map a Elas invoice to a QuickBooks Invoice.
 *
 * **ONE line, for the pre-tax amount. This is the load-bearing decision.**
 *
 * QuickBooks computes an invoice total as `Σ(lines) + TxnTaxDetail.TotalTax`. Elas's `total` is
 * tax-INCLUSIVE. So the line total must be `total − tax`: send lines summing to the full total AND
 * the tax and QuickBooks charges the tax twice.
 *
 * And it has to be one synthesised line rather than Elas's own, because Elas's lines cannot be
 * relied on to sum to anything in particular:
 *
 * - `invoices.total_cents` is a deliberate SNAPSHOT of the agreed price (`invoice.ts:37,58`);
 *   `withLines` keeps it when lines change, so the two are allowed to diverge by design.
 * - An invoice raised from a quote has the agreed total and NO lines at all.
 * - The estimate's discount is baked into that total, while the lines are the undiscounted list —
 *   so even a fully-lined invoice normally has `Σ(lines) ≠ total − tax`.
 *
 * Sending Elas's lines would therefore put a number in the books that nobody agreed to. And it
 * would buy nothing: with no pricebook link, every line carries the SAME ItemRef, so the revenue
 * breakdown in QuickBooks is identical either way. One line that is exactly right beats five that
 * are collectively wrong. Per-line detail arrives when the pricebook link does.
 *
 * The customer never sees this document — Elas sends the invoice, QuickBooks holds the books.
 */
export const toQboInvoice = (
  invoice: SyncableInvoice,
  customerId: string,
  invoiceItemId: string | null,
): Result<QboInvoiceInput, ValidationError> => {
  if (!invoiceItemId) {
    return err(validation("no QuickBooks item is chosen for invoice lines", NO_INVOICE_ITEM));
  }
  if (invoice.totalCents <= 0) {
    // A zero invoice is not a financial fact, and pushing one is more likely to record a mistake
    // than a sale. Refused rather than filed.
    return err(validation("this invoice has no amount to send", NO_AMOUNT));
  }
  // Defence in depth — the domain and a Postgres check both enforce this upstream, but this
  // function turns money into somebody's books and must not rely on that.
  if (invoice.taxCents < 0 || invoice.taxCents > invoice.totalCents) {
    return err(validation("this invoice's tax does not fit inside its total", TAX_EXCEEDS_TOTAL));
  }

  const netCents = invoice.totalCents - invoice.taxCents;

  return ok({
    customerId,
    docNumber: invoice.num,
    // The date the invoice was ISSUED, not today: a push delayed by a failed cron must not land in
    // the wrong accounting period.
    txnDate: isoDate(invoice.sentAt ?? new Date()),
    dueDate: invoice.dueAt ? isoDate(invoice.dueAt) : null,
    itemId: invoiceItemId,
    description: invoice.title?.trim() || `Invoice ${invoice.num}`,
    netAmount: dollars(netCents),
    totalTax: dollars(invoice.taxCents),
  });
};
