/**
 * Turn a sync-log error code into something a shop owner can act on.
 *
 * The codes are written by the sync use-cases (`unmapped_employee`, `no_default_item`, …) and by
 * the AppError kinds that escape a QuickBooks call. Both reach this table; anything unrecognised
 * still renders, because "we don't have a friendly name for this" is not a reason to hide from
 * somebody that their payroll hours did not arrive.
 *
 * Two fields, deliberately: `says` is what went wrong, `fix` is what to do about it. A message that
 * only states the problem leaves the reader stuck, and one that only states the fix reads as a
 * command with no reason.
 */

import {
  UNMAPPED_EMPLOYEE,
  NO_DEFAULT_ITEM,
  NOT_FINISHED,
  BREAK_NOT_PAID,
} from "./time-activity-mapping";
import { NO_NAME, NAME_TOO_LONG } from "./customer-mapping";
import { NO_AMOUNT, NO_INVOICE_ITEM, TAX_EXCEEDS_TOTAL } from "./invoice-mapping";
import {
  NO_AMOUNT as PAYMENT_NO_AMOUNT,
  INVOICE_NOT_IN_QBO,
} from "./payment-mapping";

export interface SyncProblem {
  /** The stable code, kept so support can be given something exact to search for. */
  readonly code: string;
  /** What went wrong, in one plain sentence. */
  readonly says: string;
  /** The next action, or null when there is nothing the shop can do from here. */
  readonly fix: string | null;
  /** True when retrying could plausibly work once the fix is done. A break never can. */
  readonly retryable: boolean;
}

interface Explanation {
  readonly says: string;
  readonly fix: string | null;
  readonly retryable: boolean;
}

const EXPLANATIONS: Readonly<Record<string, Explanation>> = Object.freeze({
  [UNMAPPED_EMPLOYEE]: {
    says: "This person isn't matched to anyone in QuickBooks.",
    fix: "Match them under Match your crew above, then send again.",
    retryable: true,
  },
  [NO_DEFAULT_ITEM]: {
    says: "No QuickBooks service item is chosen for crew labour.",
    fix: "Pick one under File hours under, then send again.",
    retryable: true,
  },
  [NOT_FINISHED]: {
    says: "The clock was still running on this entry.",
    fix: "End the day on the timesheet, then approve the week again.",
    retryable: true,
  },
  // Not a failure at all — it is the rule working. Listed so it never reads as a fault.
  [BREAK_NOT_PAID]: {
    says: "Break time isn't sent to QuickBooks — it isn't paid time.",
    fix: null,
    retryable: false,
  },
  [NO_NAME]: {
    says: "This customer has no name to file under in QuickBooks.",
    fix: "Give them a name on their customer record, then send again.",
    retryable: true,
  },
  [NAME_TOO_LONG]: {
    says: "This customer's name is longer than QuickBooks allows.",
    fix: "Shorten it to 100 characters or fewer, then send again.",
    retryable: true,
  },
  [NO_INVOICE_ITEM]: {
    says: "No QuickBooks item is chosen for invoice lines.",
    fix: "Pick one under File invoices under, then send again.",
    retryable: true,
  },
  [NO_AMOUNT]: {
    says: "This invoice has no amount, so there is nothing to send.",
    fix: "Add the work and its price, then send the invoice again.",
    retryable: true,
  },
  [TAX_EXCEEDS_TOTAL]: {
    says: "This invoice's tax doesn't fit inside its total.",
    fix: "Check the invoice's figures — the tax should be part of the total, not on top of it.",
    retryable: true,
  },
  [INVOICE_NOT_IN_QBO]: {
    says: "The invoice this payment settles isn't in QuickBooks yet.",
    fix: "Send the invoice first — the payment follows it over.",
    retryable: true,
  },
  [PAYMENT_NO_AMOUNT]: {
    says: "This payment has no amount, so there is nothing to send.",
    fix: null,
    retryable: false,
  },
  customer_not_linked: {
    says: "This invoice's customer is no longer matched in QuickBooks.",
    fix: "Re-match them under Match your crew, then edit the invoice again to resend it.",
    retryable: true,
  },
  gone_from_quickbooks: {
    says: "This invoice was removed inside QuickBooks, so the change had nowhere to go.",
    fix: null,
    retryable: false,
  },
  // AppError kinds, which reach the log when a QuickBooks call itself refuses.
  unauthorized: {
    says: "QuickBooks rejected the connection.",
    fix: "Reconnect QuickBooks, then send again.",
    retryable: true,
  },
  conflict: {
    says: "QuickBooks already has this record.",
    fix: null,
    retryable: false,
  },
  validation: {
    says: "QuickBooks refused the details we sent.",
    fix: "The message below is theirs — if it isn't clear, send it to support.",
    retryable: true,
  },
  external_service: {
    says: "QuickBooks didn't answer.",
    fix: "Usually temporary — send again in a few minutes.",
    retryable: true,
  },
  not_found: {
    says: "QuickBooks no longer has the record this points at.",
    fix: "Re-match the person or item it refers to, then send again.",
    retryable: true,
  },
  unmappable: {
    says: "This entry can't be turned into a QuickBooks record.",
    fix: null,
    retryable: false,
  },
});

/**
 * Explain one logged attempt. Returns null for a success — there is no problem to describe, and
 * inventing a cheerful sentence for the happy path is noise on a screen read during payroll.
 */
export const explainSyncProblem = (
  status: string,
  code: string | null,
): SyncProblem | null => {
  if (status === "succeeded") return null;

  const key = code ?? "";
  const known = Object.prototype.hasOwnProperty.call(EXPLANATIONS, key)
    ? EXPLANATIONS[key]
    : null;

  if (known) return { code: key, says: known.says, fix: known.fix, retryable: known.retryable };

  // Unknown code. Say so honestly rather than guessing at a cause, and treat it as retryable:
  // the cost of a pointless retry is one API call, the cost of hiding a recoverable failure is
  // somebody's hours missing from payroll.
  return {
    code: key || "unknown",
    says: "This didn't reach QuickBooks.",
    fix: "Try sending again. If it keeps failing, the message below is what QuickBooks said.",
    retryable: true,
  };
};
