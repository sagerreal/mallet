import { jobs } from "@mallet/shared/db/schema";
import type { SortSpec } from "@mallet/shared/db/sort-page";

/**
 * The sorts the jobs list is willing to run.
 *
 * A NAMED enum, never a column name from the client. Two reasons, and the second is the one that
 * bites later: a client-supplied column is an injection surface, and it welds the public API to
 * the table layout so renaming a column becomes a breaking API change.
 *
 * Every entry here must be backed by an index on (org_id, <column>) or the query degrades to a
 * sequential scan over the whole tenant. At 1,500 jobs nobody notices; at 40,000 the page times
 * out. See migration 0110.
 */
export const JOB_SORTS = ["scheduled", "created", "amount", "status"] as const;
export type JobSort = (typeof JOB_SORTS)[number];

/**
 * `scheduled` is the DEFAULT, and that choice is the single biggest perceived difference from
 * Jobber. A dispatcher thinks in when the work happens, never in when the row was written.
 *
 * NULLS LAST on the scheduled sort is load-bearing: an unscheduled job has scheduled_start NULL,
 * and unscheduled work is precisely what someone opens this list to find. Pinning it to the end
 * keeps it reachable instead of scattering it through the results.
 */
export const jobSortSpec = (sort: JobSort, dir?: "asc" | "desc"): SortSpec => {
  switch (sort) {
    case "scheduled":
      return { column: jobs.scheduledStart, direction: dir ?? "desc", nulls: "last" };
    case "amount":
      return { column: jobs.totalCents, direction: dir ?? "desc", nulls: "last" };
    case "status":
      return { column: jobs.status, direction: dir ?? "asc", nulls: "last" };
    case "created":
    default:
      return { column: jobs.createdAt, direction: dir ?? "desc", nulls: "last" };
  }
};

/** Column read off a row to build the next cursor — must match jobSortSpec's column exactly. */
export const jobSortValue = (sort: JobSort, row: Record<string, unknown>): unknown => {
  switch (sort) {
    case "scheduled": return row.scheduledStart;
    case "amount": return row.totalCents;
    case "status": return row.status;
    case "created":
    default: return row.createdAt;
  }
};
