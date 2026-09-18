import type { ReminderTarget } from "../domain/reminder-target-reader";

const usd = (cents: number): string => `$${(cents / 100).toFixed(2)}`;

/**
 * The customer-facing pay link for an invoice, or null when either half is missing.
 * `origin` is the CANONICAL configured origin (resolvePublicAppOrigin) — never a request URL.
 * Null means "compose without a link" rather than sending a half-built one.
 */
export const invoicePayUrl = (origin: string | null, publicToken: string | null): string | null =>
  origin && publicToken ? `${origin}/i/${publicToken}` : null;

// Pure body composers. Functional, not chatty — a short factual message with the number + balance.
// Stage-aware: later stages are firmer. Exactly ONE link per message (SMS stays short and carriers
// filter multi-link texts); without a resolvable link the copy falls back to reply-or-call.
export const composeInvoiceReminder = (
  target: ReminderTarget,
  stage: number,
  payUrl: string | null,
): string => {
  const balance = usd(target.balanceCents);
  if (stage <= 1) {
    return payUrl
      ? `Invoice ${target.num}: balance ${balance} is due. View & pay: ${payUrl}`
      : `Invoice ${target.num}: balance ${balance} is due. Reply or call to pay. Thank you.`;
  }
  return payUrl
    ? `Reminder: invoice ${target.num} balance ${balance} is past due. View & pay: ${payUrl}`
    : `Reminder: invoice ${target.num} balance ${balance} is past due. Please pay at your earliest convenience.`;
};

// A one-off "here is your invoice" send (not a reminder-sequence stage).
export const composeInvoiceSent = (target: ReminderTarget, payUrl: string | null): string =>
  payUrl
    ? `Invoice ${target.num} for ${usd(target.balanceCents)} is ready. View & pay: ${payUrl}`
    : `Invoice ${target.num} for ${usd(target.balanceCents)} is ready. Reply or call to pay. Thank you.`;

/**
 * The settled twin — sent once nothing is owed, so it must not ask for money.
 *
 * The link is the SAME /i/<token> page. In its paid state that page states the date, amount and
 * method of every payment received, which is what makes it a receipt worth keeping rather than a
 * dead pay link. Without a resolvable link there is nothing to keep, so the copy says only what
 * is true and stops.
 *
 * No amount in the sentence: the balance is zero, and naming the total here would read as a
 * fresh charge on a message whose whole point is that the bill is closed.
 */
export const composePaymentReceipt = (target: ReminderTarget, payUrl: string | null): string =>
  payUrl
    ? `Invoice ${target.num} is paid in full — thank you. Your itemized receipt: ${payUrl}`
    : `Invoice ${target.num} is paid in full — thank you.`;
