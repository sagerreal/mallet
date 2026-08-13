/**
 * features/jobs/timesheet-constants.ts
 * Domain + picker constants for timesheets.
 *
 * The overtime threshold used to live here as a constant. It is not a constant — it is per-shop
 * CONFIG, because state law inverts (federal is weekly-only, California adds a daily rule), and a
 * national product cannot compile one in. It lives on org_settings and is applied by
 * features/timesheets/overtime.ts.
 */

/** Entry kinds and their labels (order sets the segmented control). */
export const TS_KINDS: Record<string, string> = {
  job: "Job",
  travel: "Travel",
  break: "Break",
  shop: "Shop",
};
export const TS_KIND_KEYS = ["job", "travel", "break", "shop"] as const;

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
