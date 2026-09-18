/**
 * features/timesheets/overtime.ts
 * The overtime rule, and the only arithmetic in the app that applies it.
 *
 * WHY IT LIVES HERE AND NOT UNDER features/field. Two surfaces compute a technician's overtime: his
 * own My hours screen, and the OFFICE crew grid where the week is approved and pushed to
 * QuickBooks. They were computing it differently — the field surface from the shop's configured
 * rule, the office from a compiled-in forty — which meant the screen a man reads and the screen his
 * employer approves could state different overtime for the same week. That is not a rounding
 * disagreement; it is two answers to "what am I owed", and the office's was the one that reached
 * payroll.
 *
 * So the rule and its arithmetic are shared, and neither surface owns them.
 */

const MINUTES_PER_HOUR = 60;

/**
 * The shop's overtime rule, in minutes — CONFIG, never code, because state law inverts. Federal is
 * weekly-only; California adds a daily threshold. `dailyThresholdMinutes: null` means the shop has
 * no daily rule.
 */
export interface OvertimePolicy {
  readonly weeklyThresholdMinutes: number;
  readonly dailyThresholdMinutes: number | null;
}

/** The federal floor: overtime past forty hours in a week, no daily rule. */
export const FEDERAL_OVERTIME_POLICY: OvertimePolicy = {
  weeklyThresholdMinutes: 40 * MINUTES_PER_HOUR,
  dailyThresholdMinutes: null,
};

export interface OvertimeSplit {
  readonly daily: number;
  readonly weekly: number;
  readonly total: number;
}

/**
 * Split a week's WORKED hours into daily and weekly overtime WITHOUT counting an hour twice.
 *
 * The standard method, and the one a daily-overtime state requires: each day's hours past the daily
 * threshold are daily overtime, and only the STRAIGHT-TIME portion of each day (its hours up to the
 * threshold) is then tested against the weekly threshold. Five ten-hour days in California are 10h
 * of daily overtime and zero weekly — 50 hours is ten past forty, but those are the same ten hours,
 * and adding them again would pay the overage twice.
 *
 * PAID TIME OFF MUST NOT REACH THIS FUNCTION. It is paid but not worked, so it cannot create
 * overtime (FLSA is on hours worked, and Jobber and Housecall Pro both agree). Callers separate the
 * two before they get here.
 */
export function overtimeSplit(
  hoursPerDay: readonly number[],
  policy: OvertimePolicy,
): OvertimeSplit {
  const dailyLimit =
    policy.dailyThresholdMinutes === null ? null : policy.dailyThresholdMinutes / MINUTES_PER_HOUR;
  const weeklyLimit = policy.weeklyThresholdMinutes / MINUTES_PER_HOUR;

  let daily = 0;
  let straightTime = 0;
  for (const hours of hoursPerDay) {
    const overDay = dailyLimit === null ? 0 : Math.max(0, hours - dailyLimit);
    daily += overDay;
    straightTime += hours - overDay;
  }
  const weekly = Math.max(0, straightTime - weeklyLimit);
  return { daily, weekly, total: daily + weekly };
}

/** The rule in force, for a summary cell — a figure nobody can derive is a figure nobody trusts. */
export function overtimeRulePhrase(policy: OvertimePolicy): string {
  const weekly = policy.weeklyThresholdMinutes / MINUTES_PER_HOUR;
  if (policy.dailyThresholdMinutes === null) return `past ${weekly}h this week`;
  return `past ${policy.dailyThresholdMinutes / MINUTES_PER_HOUR}h a day or ${weekly}h this week`;
}

/** The weekly threshold in whole hours, for the copy that names it ("of a 40h week"). */
export function weeklyThresholdHours(policy: OvertimePolicy): number {
  return policy.weeklyThresholdMinutes / MINUTES_PER_HOUR;
}
