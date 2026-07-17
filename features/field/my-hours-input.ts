import { todayISO, addDaysISO } from "@/lib/clock";

/**
 * The EXACT input my-hours passes to v1.timesheets.list — single source of truth,
 * imported by BOTH the page (its useQuery) and the field hydrator (its idle prefetch).
 * If these were built independently the query keys could silently drift and the
 * prefetch would warm a cache entry the page never reads.
 */
export const MY_HOURS_STALE_MS = 60_000;

export function myHoursListInput(): { fromDate: string; toDate: string; limit: number } {
  const today = todayISO();
  return {
    fromDate: addDaysISO(today, -84), // 12 weeks back
    toDate: addDaysISO(today, 7), // this week + 1 for safety
    limit: 500,
  };
}
