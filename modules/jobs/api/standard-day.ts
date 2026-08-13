/**
 * modules/jobs/api/standard-day.ts — how long a person's working day IS.
 *
 * The DAY TOTAL ring divides worked time by this. The answer already lives in the schedule
 * model the dispatch board and the front desk use: a crew_schedules row per (person, weekday)
 * where one exists, the org's default day hours where none does, and 0..0 meaning a day off
 * (org-settings' own closed-day convention). This module is only the pure arithmetic — the
 * reads stay in the router.
 */

/** JS getDay() weekday of a YYYY-MM-DD date, derived in UTC so the server's zone never shifts it. */
export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

export interface OrgDayHours {
  readonly hoursWdOpen: number;
  readonly hoursWdClose: number;
  readonly hoursSatOpen: number;
  readonly hoursSatClose: number;
  readonly hoursSunOpen: number;
  readonly hoursSunClose: number;
}

interface HourWindow {
  readonly openHour: number;
  readonly closeHour: number;
}

const span = (w: HourWindow): number | null => {
  // 0..0 is "closed" (org-settings.ts isValidDayHours); anything not strictly increasing is
  // malformed and must not become a negative denominator.
  if (w.openHour === 0 && w.closeHour === 0) return null;
  if (w.closeHour <= w.openHour) return null;
  return (w.closeHour - w.openHour) * 60;
};

/**
 * Minutes in this person's standard day, or null when the day is off (empty ring, no "of" line).
 * The personal row wins outright — including a personal day off at an open org.
 */
export function standardDayMinutes(
  weekday: number,
  personal: HourWindow | null,
  org: OrgDayHours,
): number | null {
  if (personal) return span(personal);
  if (weekday === 0) return span({ openHour: org.hoursSunOpen, closeHour: org.hoursSunClose });
  if (weekday === 6) return span({ openHour: org.hoursSatOpen, closeHour: org.hoursSatClose });
  return span({ openHour: org.hoursWdOpen, closeHour: org.hoursWdClose });
}
