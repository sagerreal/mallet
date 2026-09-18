import { describe, it, expect } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { jobs } from "@mallet/shared/db/schema";
import { jobSortSpec, JOB_SORTS } from "./job-sorts";

const dialect = new PgDialect();
const rendered = (): string => dialect.sqlToQuery(jobSortSpec("scheduled").column as SQL).sql;

/**
 * The WHEN sort's SHAPE. The behaviour is proved against the live database in
 * modules/jobs/api/job-sort-page.int.test.ts; this file guards the two properties that were wrong
 * and that a passing query would not reveal.
 */
describe("jobSortSpec — the scheduled sort", () => {
  it("does NOT order on jobs.scheduled_start, which nothing writes", () => {
    // The bug. Both create paths set the column null, scheduling writes VISITS, and its only
    // writer (Job.schedule, via scheduleDirect/reschedule) has no client caller — 1,528 jobs in the
    // pilot org, zero with a value. `ORDER BY scheduled_start, id` therefore collapsed to
    // `ORDER BY id` over random v4 UUIDs, and the Jobs list was in random order.
    expect(jobSortSpec("scheduled").column).not.toBe(jobs.scheduledStart);
  });

  it("orders on the LIVE visit date the WHEN column prints", () => {
    // min(scheduled_date) over the job's non-canceled, non-deleted visits — the date job-row.ts
    // renders. Ordering on anything else puts rows in an order the column visibly contradicts.
    const sql = rendered().replace(/\s+/g, " ");
    expect(sql).toContain('min("job_visits"."scheduled_date")');
    expect(sql).toContain('"job_visits"."job_id" = "jobs"."id"');
    // Tenant-safe by correlation as well as by the outer query's org filter.
    expect(sql).toContain('"job_visits"."org_id" = "jobs"."org_id"');
    // Dead and canceled visits are not work, and the partial index that answers this subquery
    // (migration 0132) is built on exactly this predicate — the two must stay written the same way
    // or Postgres silently stops using it.
    expect(sql).toContain(`"job_visits"."status" <> 'canceled'`);
    expect(sql).toContain('"job_visits"."deleted_at" is null');
    expect(sql).not.toContain("scheduled_start");
  });

  it("puts UNPLACED work first when ascending", () => {
    // "What have I not put on a day yet, and what is next?" is the question an ascending WHEN list
    // asks. Pinning nulls last buried unplaced work behind every scheduled job in the book — and it
    // is the reason a job created minutes ago was nowhere near the top.
    const asc = jobSortSpec("scheduled", "asc");
    expect(asc.direction).toBe("asc");
    expect(asc.nulls).toBe("first");
  });

  it("puts undated work last when descending", () => {
    // Descending is a history question ("what happened most recently"), and undated work is the
    // end of that answer, so the nulls follow the direction instead of being fixed.
    const desc = jobSortSpec("scheduled", "desc");
    expect(desc.direction).toBe("desc");
    expect(desc.nulls).toBe("last");
  });

  it("defaults to ascending — unplaced first, then soonest", () => {
    expect(jobSortSpec("scheduled").direction).toBe("asc");
    expect(jobSortSpec("scheduled").nulls).toBe("first");
  });
});

describe("jobSortSpec — the other sorts are untouched", () => {
  it("keeps amount, status, customer and created on their own columns and defaults", () => {
    expect(jobSortSpec("amount")).toMatchObject({ column: jobs.totalCents, direction: "desc", nulls: "last" });
    expect(jobSortSpec("status")).toMatchObject({ column: jobs.status, direction: "asc", nulls: "last" });
    expect(jobSortSpec("created")).toMatchObject({ column: jobs.createdAt, direction: "desc", nulls: "last" });
    expect(jobSortSpec("customer").direction).toBe("asc");
  });

  it("returns a spec for every named sort, so no header can point at nothing", () => {
    for (const s of JOB_SORTS) expect(jobSortSpec(s).column).toBeTruthy();
  });
});
