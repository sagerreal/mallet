import { todayISO, addDaysISO } from "@/lib/clock";

/**
 * The EXACT input my-hours passes to v1.timesheets.list — single source of truth,
 * imported by BOTH the page (its useQuery) and the field hydrator (its idle prefetch).
 * If these were built independently the query keys could silently drift and the
 * prefetch would warm a cache entry the page never reads.
 */
export const MY_HOURS_STALE_MS = 60_000;

/**
 * `techUserId` is what makes My hours MINE.
 *
 * v1.timesheets.list forces a tech caller onto their own rows, but an owner or office caller who
 * names nobody is served the WHOLE org — so an owner-operator opening My hours got every
 * technician's rows, and the page labelled the ones that were not his with "These aren't your
 * hours". A page called My hours should not need that sentence; it should ask for his.
 *
 * Undefined until `me` resolves. The query is disabled until then rather than firing unscoped,
 * because an unscoped first fetch is exactly the bug.
 */
export function myHoursListInput(techUserId: string): {
  fromDate: string;
  toDate: string;
  limit: number;
  techUserId: string;
} {
  const today = todayISO();
  return {
    techUserId,
    fromDate: addDaysISO(today, -84), // 12 weeks back
    toDate: addDaysISO(today, 7), // this week + 1 for safety
    limit: 500,
  };
}
