/**
 * features/field/time-off-amount.ts
 * How much of a day is being claimed off — pure, so the arithmetic is testable away from the form.
 *
 * A time-off row carries a LENGTH and no times (shared/db/schema/time-entries.ts's shape check, and
 * TimeEntry.create's shape matrix). This module turns the three ways a person expresses that length
 * — the whole day, half of it, or a typed number of hours — into the single integer the row stores.
 *
 * FULL DAY IS NOT EIGHT HOURS. It is THIS person's standard day for THAT date, which the shop
 * already answers through v1.field.standardDay (their crew_schedules row, else the org's day hours,
 * else null for a day they do not work). A compiled-in 480 would short every four-tens technician
 * two hours per day taken, and the shop's own configured hours are right there to be asked.
 */

/** What the form is claiming. `custom` is the escape hatch for a part-day that is not a half. */
export type TimeOffAmount = "full" | "half" | "custom";

/** Half a day is half of the standard — named so the two call sites cannot disagree. */
export const HALF_DAY_DIVISOR = 2;

/** A whole day, the ceiling the domain enforces (MAX_TIME_OFF_MINUTES). Multi-day is one row/day. */
export const MAX_TIME_OFF_MINUTES = 1440;

const MINUTES_PER_HOUR = 60;

export interface TimeOffAmountArgs {
  readonly amount: TimeOffAmount;
  /** This person's standard day for the chosen date; null when the shop has it as a day off. */
  readonly standardMinutes: number | null;
  /** Raw text from the hours box — never trusted as a number until here. */
  readonly customHours: string;
}

/** Typed hours → whole minutes, or null when the text is not a positive number. */
const typedMinutes = (raw: string): number | null => {
  const text = raw.trim();
  if (text === "") return null;
  const hours = Number(text);
  if (!Number.isFinite(hours) || hours <= 0) return null;
  const minutes = Math.round(hours * MINUTES_PER_HOUR);
  return minutes < 1 ? null : minutes;
};

/**
 * The minutes this claim is worth, or null when it cannot be worked out yet.
 *
 * Null is "not answerable", NOT "zero": the caller shows amountProblem's sentence rather than
 * saving a row worth no time. Rounded to whole minutes because the column is an integer — a 7.5h
 * standard halves to 3h45, not 3.75 of anything.
 */
export function timeOffMinutes(args: TimeOffAmountArgs): number | null {
  if (args.amount === "custom") return typedMinutes(args.customHours);
  if (args.standardMinutes === null || args.standardMinutes <= 0) return null;
  const minutes =
    args.amount === "half"
      ? Math.round(args.standardMinutes / HALF_DAY_DIVISOR)
      : args.standardMinutes;
  return minutes < 1 ? null : minutes;
}

/**
 * The sentence refusing this claim, or null when it will save.
 *
 * Every branch names the way out. A disabled button with no explanation on the screen that decides
 * someone's pay is the failure mode this file exists to avoid.
 */
export function amountProblem(args: TimeOffAmountArgs): string | null {
  if (args.amount !== "custom" && (args.standardMinutes === null || args.standardMinutes <= 0)) {
    return "Your shop has this as a day off, so there is no standard length to take. Type the hours instead.";
  }
  if (args.amount === "custom") {
    const text = args.customHours.trim();
    if (text === "") return "Say how many hours you took.";
    const hours = Number(text);
    if (!Number.isFinite(hours)) return "Hours has to be a number, like 8 or 7.5.";
    if (hours <= 0) return "Hours has to be more than zero.";
    if (Math.round(hours * MINUTES_PER_HOUR) > MAX_TIME_OFF_MINUTES) {
      return "One row covers one day at most — add a row per day for a longer stretch.";
    }
  }
  return timeOffMinutes(args) === null ? "That is not an amount this can save." : null;
}
