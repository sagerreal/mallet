import { todayISO, addDaysISO } from "@/lib/clock";
import { weekStart, weekDates, DAYS_PER_WEEK } from "./my-hours-derive";

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
    fromDate: addDaysISO(today, -WINDOW_DAYS_BACK),
    toDate: addDaysISO(today, WINDOW_DAYS_FORWARD),
    limit: 500,
  };
}

/** Twelve weeks back — how far the timesheet history this page can answer for reaches. */
const WINDOW_DAYS_BACK = 84;
/** This week plus one, for safety at the far edge. */
const WINDOW_DAYS_FORWARD = 7;

/** The oldest and newest week the pager may land on. Both are Mondays. */
export interface MyHoursWeekBounds {
  readonly first: string;
  readonly last: string;
}

/**
 * THE PAGER'S LIMITS, DERIVED FROM THE FETCH ABOVE so the two cannot drift.
 *
 * The week arrows had no bound at all. Past the twelfth week back the register kept rendering weeks
 * out of an array that stopped — stating "No shifts recorded this week" over weeks a man had worked
 * a full five days of, which on the screen that tells him what he is owed is the worst sentence it
 * can get wrong. Forward it paged for ever, into years nobody has booked.
 *
 * The oldest week is the oldest one the window covers END TO END. The window opens mid-week, and
 * stopping on that part-week would report its uncovered days as recorded-nothing — the same lie in
 * miniature. One week is the whole cost of that.
 */
export function myHoursWeekBounds(today: string): MyHoursWeekBounds {
  const fromDate = addDaysISO(today, -WINDOW_DAYS_BACK);
  const oldest = weekStart(fromDate);
  return {
    first: weekDates(oldest)[0]! >= fromDate ? oldest : addDaysISO(oldest, DAYS_PER_WEEK),
    last: weekStart(addDaysISO(today, WINDOW_DAYS_FORWARD)),
  };
}
