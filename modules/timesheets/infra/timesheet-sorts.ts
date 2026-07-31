import { timeEntries } from "@mallet/shared/db/schema";
import type { SortSpec } from "@mallet/shared/db/sort-page";

/**
 * The sorts the time-entry list is willing to run.
 *
 * A NAMED enum, never a column from the client — same reasoning as job-sorts.ts: a client-supplied
 * column is an injection surface and it welds the API to the table layout.
 *
 * WHY THIS FILE EXISTS AT ALL, given the office panel fetches a whole week and does not page:
 * the list endpoint had a hand-rolled keyset with a live bug. It ordered by
 * (work_date, created_at, id) but its cursor encoded only (created_at, id), so wherever those two
 * orders disagreed across a page boundary — which is any shop that back-dates a correction, i.e.
 * every shop — a row could be silently skipped or repeated. Hours skipped from payroll is not a
 * cosmetic paging bug. Routing this list through the same sort/cursor machinery as every other
 * list fixes that by construction: the cursor carries the value of whatever column ORDER BY leads
 * with, because it is read from that same expression.
 *
 * THERE IS NO "week" SORT. The plan listed date/tech/week, but a week is a RANGE — it is already
 * expressed as fromDate/toDate on this endpoint, and that is what the office panel sends. A sort
 * named "week" would order rows identically to `date` while implying it did something else, which
 * is a control that lies about itself.
 */
export const TIMESHEET_SORTS = ["date", "tech"] as const;
export type TimesheetSort = (typeof TIMESHEET_SORTS)[number];

/**
 * `date` is the DEFAULT and it ascends, unlike every other list here.
 *
 * A timesheet is read forwards — Monday to Sunday, the order the week was worked and the order it
 * is approved in. Newest-first would be right for a feed and is wrong for a payroll period.
 */
export const timesheetSortSpec = (sort: TimesheetSort, dir?: "asc" | "desc"): SortSpec => {
  switch (sort) {
    case "tech":
      // Group a person's hours together — how you check one technician's week before approving it.
      // Ascending by id is not alphabetical by name, and deliberately so: the office panel already
      // has the crew list and renders the names, whereas sorting by name here would need a join to
      // users for an order the screen re-groups anyway.
      return { column: timeEntries.techUserId, direction: dir ?? "asc", nulls: "last" };
    case "date":
    default:
      return { column: timeEntries.workDate, direction: dir ?? "asc", nulls: "last" };
  }
};
