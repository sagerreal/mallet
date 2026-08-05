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
