/**
 * Who the AI front desk puts a caller through to, right now.
 *
 * Escalation used to be ONE org-wide number, so a shop with three office staff had no way to say
 * "Sarah is on today" — every urgent call went to the same phone whether or not anyone was there.
 *
 * The availability model is the one that already exists: crew_schedules holds per-person weekday
 * hours and the dispatch board reads it. A person with no row for today falls back to the org's own
 * hours, exactly as the slot maths does — otherwise turning this on would silently make everyone
 * unavailable, because most staff have no schedule rows at all.
 */

export interface OnCallCandidate {
  readonly userId: string;
  readonly name: string | null;
  /** Verified mobile. Unverified numbers are excluded upstream — see pickOnCall. */
  readonly phone: string;
  /** Their hours for TODAY, or null when they have no override and inherit the org's. */
  readonly todayHours: { readonly openHour: number; readonly closeHour: number } | null;
}

export interface PickOnCallInput {
  readonly candidates: readonly OnCallCandidate[];
  /** The org's own opening hours for today, the fallback for anyone with no override. */
  readonly orgHours: { readonly openHour: number; readonly closeHour: number };
  /** Local hour in the ORG's timezone, 0–23. */
  readonly hourNow: number;
}

/** A day with open === close === 0 is the schema's "closed" sentinel, not a midnight-to-midnight day. */
const isClosed = (h: { openHour: number; closeHour: number }): boolean => h.openHour === 0 && h.closeHour === 0;

const isOnShift = (c: OnCallCandidate, orgHours: PickOnCallInput["orgHours"], hourNow: number): boolean => {
  const hours = c.todayHours ?? orgHours;
  if (isClosed(hours)) return false;
  return hourNow >= hours.openHour && hourNow < hours.closeHour;
};

/**
 * The person to ring, or null when nobody is on.
 *
 * Null is a real answer, not a failure: the caller should fall back to the org's own emergency
 * number rather than ringing somebody at home because the rota was empty.
 *
 * Ties break on name, then userId — deterministic on purpose, so the same caller at the same time
 * does not reach a different person on a retry.
 */
export function pickOnCall(input: PickOnCallInput): OnCallCandidate | null {
  const available = input.candidates
    .filter((c) => isOnShift(c, input.orgHours, input.hourNow))
    .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "") || a.userId.localeCompare(b.userId));

  return available[0] ?? null;
}

/**
 * Reads the people a shop has said may be interrupted by a caller, with today's hours.
 *
 * Returns only staff who could actually be reached: `takes_calls` set AND a VERIFIED callback
 * number. An unverified number is digits somebody typed into a settings box, and putting a
 * customer through to it is a worse failure than not transferring at all.
 */
export interface OnCallReader {
  findAvailable(orgId: string, weekday: number): Promise<readonly OnCallCandidate[]>;
}
