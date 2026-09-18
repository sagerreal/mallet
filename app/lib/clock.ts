/**
 * lib/clock.ts
 * The single, unfrozen "now" for app logic. Call todayISO() wherever code
 * means "what day is it right now" — never import TODAY_ISO from prototype-sample
 * for runtime logic (that constant stays frozen for sample data and tests).
 *
 * In tests, @/lib/clock is mocked via vitest.setup.ts so every fixture authored
 * against 2026-07-01 stays green.
 */

/** Returns the current date as an ISO string (YYYY-MM-DD). */
export function todayISO(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12).toISOString().slice(0, 10);
}

/** Returns an ISO date string N calendar days from the given ISO date. */
export function addDaysISO(iso: string, n: number): string {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Returns an ISO date string N calendar days from today. */
export function daysFromTodayISO(n: number): string {
  return addDaysISO(todayISO(), n);
}

/**
 * Whole calendar days between an ISO timestamp and today — 0 for anything raised today.
 *
 * Calendar days, not elapsed 24-hour periods: an invoice raised at 11pm last night is "1 day old"
 * to the person looking at it this morning, not zero. Negative inputs (a future timestamp) floor
 * at 0 rather than reporting a negative age.
 */
export function daysSince(iso: string): number {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return 0;
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = startOf(new Date()) - startOf(then);
  return Math.max(0, Math.round(diff / 86_400_000));
}
