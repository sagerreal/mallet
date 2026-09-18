import type { Result, ValidationError } from "@mallet/shared/types";
import { ok, err, validation } from "@mallet/shared/types";
import type { QboTimeActivityInput } from "./qbo-api-gateway";
import type { SyncableTimeEntry, PersonLink } from "./time-activity-mapping";
import { UNMAPPED_EMPLOYEE, NO_DEFAULT_ITEM, NOT_FINISHED, ZERO_DURATION } from "./time-activity-mapping";

/**
 * modules/accounting-sync/domain/day-total-mapping.ts
 * One QuickBooks TimeActivity per person per DAY — the day total, and nothing else.
 *
 * THE DECISION THIS IMPLEMENTS. QuickBooks is paid to run payroll; it is paid for HOURS. What each
 * hour was spent on is Mallet's job costing and never leaves Mallet. Jobber and Housecall Pro both
 * work this way — Jobber's own documentation says that when you run payroll in QuickBooks, only the
 * total hours per team member appear.
 *
 * We used to push one activity per time entry. The arithmetic came out the same, but it sent the
 * shift's internal structure to a system with nowhere to put it: `QboTimeActivityInput` carries no
 * customer and no job, so a row that says "3.58 h" tells QuickBooks nothing a day total would not,
 * while inviting somebody to read those rows as separate work.
 *
 * BREAKS AND JOB ROWS ARE EXCLUDED. Breaks are unpaid; job rows are costing, and run beside the
 * shift rather than being part of it.
 *
 * A DAY IS ALL OR NOTHING. If any entry on it cannot be read, the whole day is refused rather than
 * silently totalling the rest: a day short by one entry is a short paycheque that looks correct.
 */

/** A day's worth of one technician's entries, ready to become a single activity. */
export interface DayTotal {
  readonly techUserId: string;
  readonly workDate: string;
  readonly minutes: number;
  /** The entries that made up the total — what the sync log records as covered. */
  readonly entryIds: readonly string[];
}

const toMinutes = (t: string): number | null => {
  const [h, m] = t.split(":");
  const hh = Number(h);
  const mm = Number(m);
  if (!Number.isInteger(hh) || !Number.isInteger(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
};

/**
 * The idempotency key for a day's push.
 *
 * `qbo_sync_log` guarantees at most one SUCCEEDED row per (org, entity_type, mallet_id), and that
 * guarantee is the only thing standing between an at-least-once outbox and paying somebody twice.
 * The unit being pushed is now a day, so the key has to be the day — `mallet_id` is already `text`,
 * so no migration is involved.
 */
export const dayKey = (techUserId: string, workDate: string): string => `${techUserId}:${workDate}`;

/**
 * Group a technician's approved entries into day totals.
 *
 * Days are returned in date order so a partial failure stops at a predictable place and the log
 * reads chronologically.
 */
export function toDayTotals(entries: readonly SyncableTimeEntry[]): Result<DayTotal[], ValidationError> {
  const byDay = new Map<string, { minutes: number; ids: string[]; techUserId: string }>();

  for (const e of entries) {
    // Unpaid, so not hours worked. Excluded before any other check — a malformed break must not
    // refuse a day it was never going to contribute to.
    // Unpaid, so not hours worked — and a JOB row is costing, not time tracking. It runs beside
    // the shift rather than being part of it, so counting it here would send a twelve-hour day to
    // payroll as fifteen.
    if (e.kind === "break" || e.kind === "job") continue;
    if (!e.endTime) return err(validation("the timer is still running", NOT_FINISHED));

    const start = toMinutes(e.startTime);
    const end = toMinutes(e.endTime);
    if (start === null || end === null) {
      return err(validation("the entry has an unreadable time", "malformed_time"));
    }
    const span = end - start;
    if (span <= 0) return err(validation("the entry is zero-length", ZERO_DURATION));

    const day = byDay.get(e.workDate) ?? { minutes: 0, ids: [], techUserId: e.techUserId };
    day.minutes += span;
    day.ids.push(e.id);
    byDay.set(e.workDate, day);
  }

  const days = [...byDay.entries()]
    .map(([workDate, d]) => ({
      techUserId: d.techUserId,
      workDate,
      minutes: d.minutes,
      entryIds: d.ids,
    }))
    .sort((a, b) => (a.workDate < b.workDate ? -1 : a.workDate > b.workDate ? 1 : 0));

  return ok(days);
}

/**
 * One day total as a QuickBooks TimeActivity.
 *
 * NOT BILLABLE. The old per-entry push flagged job rows billable, which is a claim about a customer
 * QuickBooks was never told the name of. A day total spans whatever the man did, so the flag would
 * be a guess; billing lives in Mallet's own invoices.
 */
export function toDayTimeActivity(
  day: DayTotal,
  person: PersonLink | null,
  defaultItemId: string | null,
): Result<QboTimeActivityInput, ValidationError> {
  if (!person) {
    return err(validation("this person is not matched to a QuickBooks employee", UNMAPPED_EMPLOYEE));
  }
  if (!defaultItemId) {
    return err(validation("no QuickBooks service item is chosen", NO_DEFAULT_ITEM));
  }
  if (day.minutes <= 0) return err(validation("the day totals no worked time", ZERO_DURATION));

  return ok({
    txnDate: day.workDate,
    personId: person.qboId,
    personKind: person.kind,
    itemId: defaultItemId,
    hours: Math.floor(day.minutes / 60),
    minutes: day.minutes % 60,
    // Deliberately plain. The old description carried the entry's own note, which put a job name
    // into a row that is no longer about one job.
    description: "Hours worked",
    billable: false,
  });
}
