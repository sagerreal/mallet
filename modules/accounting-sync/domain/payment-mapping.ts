import type { Result, ValidationError } from "@mallet/shared/types";
import { validation, ok, err } from "@mallet/shared/types";

/** One Mallet payment, narrowed to what QuickBooks needs. Money in integer cents. */
export interface SyncablePayment {
  readonly id: string;
  readonly invoiceId: string;
  readonly amountCents: number;
  readonly receivedAt: Date;
}

/** What we send to create a QuickBooks Payment. Money in DOLLARS — QBO's API is decimal. */
export interface QboPaymentInput {
  readonly customerId: string;
  /** The QuickBooks invoice this settles. A payment with no invoice is an unapplied credit. */
  readonly invoiceQboId: string;
  readonly txnDate: string; // YYYY-MM-DD
  readonly amount: number;
}

export const NO_AMOUNT = "payment_has_no_amount";
export const INVOICE_NOT_IN_QBO = "invoice_not_in_quickbooks";

const dollars = (cents: number): number => Math.round(cents) / 100;

const isoDate = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

/**
 * Map a Mallet payment to a QuickBooks Payment.
 *
 * This is the half that makes the books reconcile. Without it every synced invoice sits in
 * QuickBooks unpaid forever: the shop's receivables climb with money they have already collected,
 * and reconciling the bank against the ledger stops working.
 *
 * **It is LINKED to the invoice, never a bare payment.** QuickBooks accepts an unlinked payment and
 * files it as an unapplied credit on the customer — the money appears, the invoice still reads
 * open, and somebody has to match them by hand later. Linking is the entire point.
 *
 * **Dated when the money arrived**, not when the push ran, so a delayed sync cannot move a receipt
 * into the wrong period.
 */
export const toQboPayment = (
  payment: SyncablePayment,
  customerId: string,
  invoiceQboId: string | null,
): Result<QboPaymentInput, ValidationError> => {
  if (!invoiceQboId) {
    // The invoice never reached QuickBooks — usually because it was never sent, or its own push
    // failed. Recorded as such rather than filed as a floating credit against the customer.
    return err(
      validation("the invoice this pays is not in QuickBooks yet", INVOICE_NOT_IN_QBO),
    );
  }
  if (payment.amountCents <= 0) {
    return err(validation("this payment has no amount to send", NO_AMOUNT));
  }

  return ok({
    customerId,
    invoiceQboId,
    txnDate: isoDate(payment.receivedAt),
    amount: dollars(payment.amountCents),
  });
};
