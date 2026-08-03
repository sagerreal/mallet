import { sql } from "drizzle-orm";
import { jobs, jobVisits, leads } from "@mallet/shared/db/schema";
import type { SortSpec } from "@mallet/shared/db/sort-page";

/**
 * The sorts the jobs list is willing to run.
 *
 * A NAMED enum, never a column name from the client. Two reasons, and the second is the one that
 * bites later: a client-supplied column is an injection surface, and it welds the public API to
 * the table layout so renaming a column becomes a breaking API change.
 *
 * Every entry here must be backed by an index the ORDER BY can use — for a column that means an
 * index on (org_id, <column>); for `scheduled`, which orders on a subquery, it means the index
 * that subquery reads (see below). Without one the query degrades to a sequential scan over the
 * whole tenant: at 1,500 jobs nobody notices, at 40,000 the page times out. See migrations 0110
 * and 0132.
 */
export const JOB_SORTS = ["scheduled", "created", "amount", "status", "customer"] as const;
export type JobSort = (typeof JOB_SORTS)[number];

/**
 * The date the WHEN column actually shows: the earliest LIVE visit on the job.
 *
 * THIS REPLACES `jobs.scheduled_start`, WHICH IS A DEAD COLUMN. Nothing in a live path writes it.
 * Both create paths set it null (create-manual-job.ts, create-job-from-estimate.ts) and scheduling
 * goes through VISITS — `Job.withVisits()` never touches the header field. Its only writer,
 * `Job.schedule()`, is reachable solely from `v1.jobs.scheduleDirect` and `v1.jobs.reschedule`,
 * neither of which has a client caller. Measured against the live database: 1,528 jobs in the
 * pilot org, ZERO with a non-null scheduled_start.
 *
 * So `ORDER BY scheduled_start ASC NULLS LAST, id ASC` collapsed to `ORDER BY id ASC` over random
 * v4 UUIDs. The Jobs list was in RANDOM ORDER and a newly created job had roughly a 3% chance of
 * landing on page one. That is the bug: a job created minutes ago was nowhere to be found, while
 * the visible rows were whatever UUIDs happened to sort first.
 *
 * `min(...)` over non-canceled, non-deleted visits, because that is the date job-row.ts renders:
 * `scheduledWhen` reads the next live visit, and a job with one visit — which is nearly all of
 * them — has exactly one candidate. Ordering on anything else puts rows in an order the WHEN
 * column visibly contradicts.
 *
 * COST. A correlated subquery cannot be answered from an index on `jobs`, so the ORDER BY sorts in
 * memory and evaluates the subquery per row. Each evaluation is an index-only scan of
 * `job_visits_org_job_date_idx` (migration 0132) — microseconds — and the sort is over the tenant's
 * job count. Fine at 1,528. If this list ever reaches tens of thousands of jobs the answer is a
 * maintained `next_visit_date` column on `jobs`, not a bigger index; ordering on a subquery is the
 * honest version of a date that genuinely lives on another table.
 */
export const nextActiveVisitDate = sql`(
  select min(${jobVisits.scheduledDate})
  from ${jobVisits}
  where ${jobVisits.orgId} = ${jobs.orgId}
    and ${jobVisits.jobId} = ${jobs.id}
    and ${jobVisits.status} <> 'canceled'
    and ${jobVisits.deletedAt} is null
)`;

/**
 * `scheduled` is the DEFAULT, and that choice is the single biggest perceived difference from
 * Jobber. A dispatcher thinks in when the work happens, never in when the row was written.
 *
 * NULLS FIRST WHEN ASCENDING is load-bearing and is the opposite of what this used to do. A job
 * with no live visit has no date, and unplaced work is precisely the question the dispatcher opens
 * an ascending WHEN list to ask: "what have I not put on a day yet, and what is next?" Pinning
 * unplaced work to the END buried it behind every scheduled job in the book. Descending — "what
 * happened most recently" — is a history question, and undated work belongs at the end of that
 * one, so the nulls follow the direction rather than being fixed.
 */
export const jobSortSpec = (sort: JobSort, dir?: "asc" | "desc"): SortSpec => {
  switch (sort) {
    case "scheduled": {
      // Ascending by default: unplaced first, then soonest. The old default was descending against
      // a column that was always null, so it ordered nothing either way.
      const d = dir ?? "asc";
      return { column: nextActiveVisitDate, direction: d, nulls: d === "asc" ? "first" : "last" };
    }
    case "amount":
      return { column: jobs.totalCents, direction: dir ?? "desc", nulls: "last" };
    case "status":
      return { column: jobs.status, direction: dir ?? "asc", nulls: "last" };
    case "customer":
      // leads.name, reached by a JOIN the repository adds for this sort alone. jobs → leads is
      // many-to-one, so the join cannot multiply rows and the keyset holds. A correlated subquery
      // reads safer but cannot use an index: measured against production, 53ms of sequential scan
      // versus 6ms of index-only scan on leads_org_name_idx.
      //
      // Ascending by default, because this sort exists for LOOKING SOMEONE UP — alphabetical is
      // the only order in which "scroll to the M's" means anything.
      return { column: leads.name, direction: dir ?? "asc", nulls: "last" };
    case "created":
    default:
      return { column: jobs.createdAt, direction: dir ?? "desc", nulls: "last" };
  }
};
