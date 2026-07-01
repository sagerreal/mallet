import type { ReminderTarget } from "../domain/reminder-target-reader";

const usd = (cents: number): string => `$${(cents / 100).toFixed(2)}`;

// Pure body composers. Functional, not chatty — a short factual message with the number + balance.
// Stage-aware: later stages are firmer. No brand fluff; the real templates can be tuned later.
export const composeInvoiceReminder = (target: ReminderTarget, stage: number): string => {
  const balance = usd(target.balanceCents);
  if (stage <= 1) {
    return `Invoice ${target.num}: balance ${balance} is due. Reply or call to pay. Thank you.`;
  }
  return `Reminder: invoice ${target.num} balance ${balance} is past due. Please pay at your earliest convenience.`;
};

// A one-off "here is your invoice" send (not a reminder-sequence stage).
export const composeInvoiceSent = (target: ReminderTarget): string =>
  `Invoice ${target.num} for ${usd(target.balanceCents)} is ready. Reply or call to pay. Thank you.`;
