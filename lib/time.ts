/**
 * lib/time.ts
 * Pure time-format helpers shared across the Jobs feature (schedule board,
 * timesheets, job list). Two clock formats coexist on purpose:
 *   • timeLabelShort — "8a" / "1:30p" — compact board/agenda labels
 *   • (12h "8:00 AM" lives in features/home/derive.ts as timeLabel, a different
 *     contract; do NOT merge — callers pick the one they mean)
 */

export const MINUTES_PER_HOUR = 60;

/** Milliseconds in a minute — for the "how long since" figures derived from two Date stamps. */
export const MS_PER_MINUTE = 60_000;

/** Decimal hours → compact label: 8 → "8a", 13.5 → "1:30p". */
export function timeLabelShort(h: number): string {
  const hour = Math.floor(h);
  const min = Math.round((h - hour) * MINUTES_PER_HOUR);
  const period = hour < 12 ? "a" : "p";
  const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return min > 0 ? `${displayHour}:${min.toString().padStart(2, "0")}${period}` : `${displayHour}${period}`;
}

/** Decimal hours → duration label: 1.5 → "1h 30m", 2 → "2h", 0.5 → "30m". */
export function hmLabel(h: number): string {
  const hrs = Math.floor(h);
  const mins = Math.round((h - hrs) * MINUTES_PER_HOUR);
  if (!hrs && mins) return `${mins}m`;
  if (!mins) return `${hrs}h`;
  return `${hrs}h ${mins}m`;
}

/** ISO date → weekday label ("Wed"). Noon anchor avoids TZ drift. */
export function colLabel(iso: string): string {
  return new Date(iso + "T12:00:00").toLocaleDateString(undefined, { weekday: "short" });
}

/** Local Y-M-D, never UTC — `toISOString()` would roll the date back east of UTC+12. */
function isoLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * The Monday that starts the calendar week containing `iso`.
 *
 * The dispatch board's week used to begin on whatever day you happened to open it, so "this week"
 * ran Thu→Wed and the same visit fell in a different week depending on when you looked. A shop's
 * week is a calendar week; snapping to Monday is what makes "next week" mean one thing to the
 * dispatcher and the crew. Noon anchor for the same reason as daysBetweenISO — it survives DST.
 */
export function mondayOf(iso: string): string {
  const d = new Date(iso + "T12:00:00");
  // getDay() is 0 for SUNDAY, which ends this week rather than starting the next one — so it
  // steps back six days. A bare `getDay() - 1` would send Sunday forward a day instead.
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return isoLocal(d);
}

/**
 * A week's two ends: "Aug 17 – 23", or "Aug 31 – Sep 6" when it spans two months.
 *
 * Replaces a label that read "Week of Thu" — a weekday with no date, which told you nothing about
 * WHICH week you had paged to. The month repeats only when it changes, because "Aug 17 – Aug 23"
 * spends a word on something the reader already has.
 *
 * `locales` exists so tests can pin a format; callers pass nothing, which is what respects the
 * dispatcher's own locale the way colLabel does.
 */
export function weekRangeLabel(startIso: string, locales?: Intl.LocalesArgument): string {
  const start = new Date(startIso + "T12:00:00");
  const end = new Date(startIso + "T12:00:00");
  end.setDate(end.getDate() + 6);
  const sameMonth = start.getMonth() === end.getMonth();
  return `${start.toLocaleDateString(locales, { month: "short", day: "numeric" })} – ${end.toLocaleDateString(
    locales,
    sameMonth ? { day: "numeric" } : { month: "short", day: "numeric" },
  )}`;
}

/**
 * Signed calendar days between two ISO DATES — positive when `to` is later.
 *
 * Noon-anchored on both sides, which is the whole point: `new Date("2026-06-28")` is UTC midnight,
 * and west of Greenwich that lands on the 27th local, so a naive diff is off by one for half the
 * world. Anchoring at noon also survives a DST boundary, where the local day is 23 or 25 hours.
 *
 * Takes both dates rather than reading the clock, so callers stay testable and the caller decides
 * whose "today" this is (the Jobs list uses the dispatcher's browser day — see job-views.ts).
 * `lib/clock.ts`'s daysSince answers a related question for ISO TIMESTAMPS; task-dates.ts carries
 * a private copy of this arithmetic for due-date labels. Worth collapsing into this one day.
 */
export function daysBetweenISO(from: string, to: string): number {
  const noon = (iso: string) => new Date(iso + "T12:00:00").getTime();
  const a = noon(from);
  const b = noon(to);
  if (isNaN(a) || isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/**
 * ISO date → a SPECIFIC date label: "Today", "May 8", or "May 8, 2025" across a year boundary.
 * A bare weekday is week-scale vocabulary — printed over an arbitrary date it lies: a stale
 * May 8 row read "Fri 11a" on the Jobs list, indistinguishable from the coming Friday.
 */
export function whenDateLabel(iso: string, todayIso: string): string {
  if (iso === todayIso) return "Today";
  const d = new Date(iso + "T12:00:00");
  if (isNaN(d.getTime())) return "";
  const sameYear = iso.slice(0, 4) === todayIso.slice(0, 4);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

/** "HH:MM" → decimal hours (timesheet clock strings). */
export function timeToH(s: string): number {
  const p = (s || "").split(":");
  return (Number(p[0]) || 0) + (Number(p[1]) || 0) / MINUTES_PER_HOUR;
}

/** Decimal hours → "HH:MM" (timesheet clock strings). */
export function hToTime(h: number): string {
  let hr = Math.floor(h);
  let mn = Math.round((h - hr) * MINUTES_PER_HOUR);
  if (mn === MINUTES_PER_HOUR) {
    hr++;
    mn = 0;
  }
  return String(hr).padStart(2, "0") + ":" + String(mn).padStart(2, "0");
}
