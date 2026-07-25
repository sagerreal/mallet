/**
 * features/jobs/timesheet-constants.ts
 * Domain + picker constants for timesheets. FULL_TIME_HOURS_PER_WEEK is a real
 * payroll rule (regular-vs-overtime split) — named so it's never a bare 40.
 */

/** Entry kinds and their labels (order sets the segmented control). */
export const TS_KINDS: Record<string, string> = {
  job: "Job",
  travel: "Travel",
  break: "Break",
  shop: "Shop",
};
export const TS_KIND_KEYS = ["job", "travel", "break", "shop"] as const;

/** Hours past this in a week count as overtime. */
export const FULL_TIME_HOURS_PER_WEEK = 40;

/** Time picker window + step (6:00a–8:00p at 15-min steps). */
export const TIMESHEET_PICKER_MIN_HOUR = 6;
export const TIMESHEET_PICKER_MAX_HOUR = 20;
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
