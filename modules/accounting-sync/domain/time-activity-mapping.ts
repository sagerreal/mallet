import type { Result, ValidationError } from "@mallet/shared/types";
import { ok, err, validation } from "@mallet/shared/types";
import type { QboTimeActivityInput } from "./qbo-api-gateway";

/** The bits of a Mallet time entry this mapping needs. Keeps the module off the timesheets domain. */
export interface SyncableTimeEntry {
  readonly id: string;
  readonly techUserId: string;
  readonly workDate: string; // YYYY-MM-DD
  readonly kind: "job" | "travel" | "break" | "shop";
  readonly startTime: string; // HH:MM
  readonly endTime: string | null;
  readonly note: string;
}

/** How a Mallet user resolves to a QuickBooks person. */
export interface PersonLink {
  readonly qboId: string;
  readonly kind: "Employee" | "Vendor";
}

export const UNMAPPED_EMPLOYEE = "unmapped_employee";
export const NO_DEFAULT_ITEM = "no_default_item";
export const NOT_FINISHED = "entry_not_finished";
export const ZERO_DURATION = "zero_duration";
export const BREAK_NOT_PAID = "break_not_synced";

const toMinutes = (t: string): number | null => {
  const [h, m] = t.split(":");
  const hh = Number(h);
  const mm = Number(m);
  if (!Number.isInteger(hh) || !Number.isInteger(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
};

/**
 * Map one approved Mallet time entry to a QuickBooks TimeActivity.
 *
 * Deliberate choices, each of which affects somebody's paycheck:
 *
 * - **Hours + Minutes, not StartTime/EndTime.** Our `time` columns are naive local wall-clock with
 *   no zone, while TimeActivity's start/end carry an offset and a flag about whether it has already
 *   been applied. Getting that wrong shifts an entry to the wrong DAY. Duration is unambiguous and
 *   is what payroll actually consumes; the clock times stay visible in Mallet.
 * - **No HourlyRate / CostRate.** QuickBooks already knows what the person is paid. Sending a rate
 *   would let Mallet silently contradict payroll — and Mallet does not even store a wage (HOURS
 *   only, by design).
 * - **No PayrollItemRef — a KNOWN GAP, not a preference.** That field ties an entry to a pay TYPE
 *   (regular / overtime / holiday), which is what a payroll run consumes. Its value is a
 *   compensation id, obtainable only from Intuit's `payrollEmployeeCompensations` GraphQL query,
 *   which is gated behind the `payroll.compensation.read` scope — a PREMIUM API requiring Gold
 *   tier (500+ active connections). We cannot fetch one on the free Builder tier, and Intuit's own
 *   examples show "project only (no pay type)" as a valid payload, which is the shape we send.
 *   Consequence: these hours reliably land in QuickBooks (visible, billable, job-costable). Whether
 *   they also PREFILL a payroll run without a pay type is unverified — see the research doc.
 * - **No overtime split.** QBO Payroll computes overtime itself from total hours. Sending our 40h
 *   split pre-applied would double-count it. Our rule stays a display concern.
 * - **Breaks are never sent.** Unpaid break time is not worked time; pushing it would inflate pay.
 * - **`travel` and `shop` go across as non-billable** worked time: the crew is on the clock, but
 *   there is no customer to bill.
 */
export const toTimeActivity = (
  entry: SyncableTimeEntry,
  person: PersonLink | null,
  defaultItemId: string | null,
): Result<QboTimeActivityInput, ValidationError> => {
  // Ordered so the most actionable problem wins: a shop can fix a mapping, but a break is simply
  // never syncable.
  if (entry.kind === "break") {
    return err(validation("break time is not sent to QuickBooks", BREAK_NOT_PAID));
  }
  if (!person) {
    return err(validation("this person is not matched to a QuickBooks employee", UNMAPPED_EMPLOYEE));
  }
  if (!defaultItemId) {
    return err(validation("no QuickBooks service item is chosen", NO_DEFAULT_ITEM));
  }
  if (!entry.endTime) {
    return err(validation("the timer is still running", NOT_FINISHED));
  }

  const start = toMinutes(entry.startTime);
  const end = toMinutes(entry.endTime);
  if (start === null || end === null) {
    return err(validation("the entry has an unreadable time", "malformed_time"));
  }
  const total = end - start;
  if (total <= 0) {
    return err(validation("the entry is zero-length", ZERO_DURATION));
  }

  return ok({
    txnDate: entry.workDate,
    personId: person.qboId,
    personKind: person.kind,
    itemId: defaultItemId,
    hours: Math.floor(total / 60),
    minutes: total % 60,
    // The note is what the shop already wrote; falling back to the kind keeps the QBO row readable
    // rather than blank.
    description: entry.note.trim() || entry.kind,
    billable: entry.kind === "job",
  });
};
