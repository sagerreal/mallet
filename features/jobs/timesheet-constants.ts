/**
 * features/jobs/timesheet-constants.ts
 * Domain + picker constants for timesheets.
 *
 * The overtime threshold used to live here as a constant. It is not a constant — it is per-shop
 * CONFIG, because state law inverts (federal is weekly-only, California adds a daily rule), and a
 * national product cannot compile one in. It lives on org_settings and is applied by
 * features/timesheets/overtime.ts.
 */

/**
 * Entry kinds and their labels (order sets the segmented control).
 *
 * The four TIME-OFF kinds are here too, and they have to be: without them a technician's holiday
 * rendered its kind pill as `undefined` in the office grid, on the screen where the week is signed.
 */
export const TS_KINDS: Record<string, string> = {
  job: "Job",
  travel: "Travel",
  break: "Break",
  shop: "Regular",
  pto: "PTO",
  vacation: "Vacation",
  sick: "Sick",
  holiday: "Holiday",
};

/** The kinds recorded by a CLOCK — they carry a start and an end. */
export const TS_KIND_KEYS = ["job", "travel", "break", "shop"] as const;

/**
 * The kinds that are paid ABSENCE — a date and a length, no punch times.
 *
 * The office is the only place these can be entered on most accounts: "Techs can edit their own
 * times" defaults OFF (the Housecall Pro model), so if this picker does not offer time off, nobody
 * in the shop can record a holiday at all.
 */
export const TS_TIME_OFF_KEYS = ["pto", "vacation", "sick", "holiday"] as const;

export const tsIsTimeOffKind = (kind: string): boolean =>
  (TS_TIME_OFF_KEYS as readonly string[]).includes(kind);

/**
 * Selectable lengths for a day off, in minutes: half-hour steps from 30 minutes to twelve hours.
 *
 * HALF-HOUR steps because that is how time off is actually taken and paid — a half day, a two-and-a
 * half hour dentist appointment. Anything coarser makes the shop record a number that is not what
 * happened.
 */
export const TS_TIME_OFF_MINUTES: readonly number[] = Array.from(
  { length: 24 },
  (_, i) => (i + 1) * 30,
);

/** The default length for a new day off: a standard working day. */
export const TS_TIME_OFF_DEFAULT_MINUTES = 8 * 60;

/** "8h" / "7h 30m" — how a length reads on a row and in the picker. */
export function tsMinutesLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (!hours) return `${mins}m`;
  return mins ? `${hours}h ${mins}m` : `${hours}h`;
}

/**
 * The tag `ApproveWeekUseCase` puts on its refusal when a week still holds hours with no end time
 * (`UNFINISHED_DAYS` in modules/timesheets/app/approve-week.ts).
 *
 * Restated here rather than imported: reaching into the module would pull its router — and with it
 * the whole database layer — into the client bundle. It is a WIRE value shared by both sides, and
 * `timesheets-slice.approve.test.ts` asserts the two spellings still match.
 */
export const UNFINISHED_DAYS_TAG = "unfinishedDays";

/** Time picker window + step (6:00a–8:00p at 15-min steps). */
export const TIMESHEET_PICKER_MIN_HOUR = 6;
/**
 * The picker must reach the end of the day, not the end of an office shift.
 *
 * This was 20 (8pm), which made the emergency call unfixable: a tech arrives at 20:45, works to
 * 23:30, forgets to end the day, and the office is then told by the approval refusal to "stop each
 * one below" — with no option in the list later than 8pm. The one control the refusal points at
 * could not perform the correction it demanded.
 *
 * 23.75 is the last quarter-hour of the day. A segment running past midnight is a different problem
 * and is handled by the clock's bounded close, not by this picker.
 */
export const TIMESHEET_PICKER_MAX_HOUR = 23.75;
export const TIME_PICKER_STEP_HOURS = 0.25;

/** Cap on job-picker suggestions in the "other open jobs" group. */
export const MAX_JOB_SUGGESTIONS = 60;

/**
 * Default span for a hand-recorded entry. The office grid records work that ALREADY happened, so a
 * new row is a complete, editable shift — never an open-ended timer. (Clocking in live is the field
 * app's job; a half-open entry can't be approved, can't be totalled, and QuickBooks rejects it.)
 */
export const TS_DEFAULT_START = "08:00";
export const TS_DEFAULT_END = "16:00";

/**
 * Longer than this and a BREAK was almost certainly left running rather than taken.
 *
 * Break is the only unpaid kind, so an unended break silently short-pays the technician for the rest
 * of the day — and because the row is finished, nothing else in the system objects. Two hours is
 * generous for a real lunch and far short of an afternoon.
 */
export const MAX_PLAUSIBLE_BREAK_HOURS = 2;

/**
 * Longer than this and a PAID segment was probably left running. Matches the clock's own
 * MAX_OPEN_SEGMENT_MS (12h) so the two agree about what "one unbroken stretch" means: a row the
 * clock had to cap should be exactly a row this flags.
 */
export const MAX_PLAUSIBLE_SEGMENT_HOURS = 12;
