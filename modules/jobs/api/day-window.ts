/**
 * The server-side bound on v1.field.day's date input.
 *
 * The CLIENT owns the pager rule — "±14 days from today" is a statement about the day where the
 * van is, and there is no org timezone column for the server to reproduce it (the same reasoning
 * as myDayInput's client-supplied instants). What the server owes is a ceiling: a forged or
 * runaway date must not turn the field agenda into a scan of the shop's whole history. So the
 * bound is the pager's reach plus ONE day of timezone slack each way — a client at UTC-11 paging
 * to its own +14th day can legitimately name a date that is 15 days out in UTC terms.
 */

const MS_PER_DAY = 86_400_000;

/** The pager's 14, plus one day of timezone slack. Named in the error message. */
export const DAY_PAGER_BOUND_DAYS = 15;

/**
 * Whether a `YYYY-MM-DD` date is within reach of the day pager, judged against `now`.
 *
 * Impossible-but-well-formed dates ("2026-02-30") parse to NaN or roll over; both are rejected by
 * the round-trip check rather than admitted by NaN comparisons.
 */
export function withinDayPagerBound(date: string, now: Date): boolean {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  // The string-form Date constructor rolls "2026-02-30" over to March 2 — the round-trip
  // catches what the regex cannot.
  if (parsed.toISOString().slice(0, 10) !== date) return false;
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const diffDays = Math.abs(parsed.getTime() - todayUtc) / MS_PER_DAY;
  return diffDays <= DAY_PAGER_BOUND_DAYS;
}
