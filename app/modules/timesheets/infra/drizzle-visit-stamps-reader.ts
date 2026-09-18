import { sql } from "drizzle-orm";
import type { TenantTx } from "@mallet/shared/db/tx";
import type { OrgId, UserId } from "@mallet/shared/types";

/**
 * modules/timesheets/infra/drizzle-visit-stamps-reader.ts
 * What a person's hours were SPENT ON — the visit taps behind a week, job by job.
 *
 * WHY THIS IS NOT THE CLOCK, AND MUST NOT BECOME IT. The day clock answers "what am I paid for".
 * This answers a different question — "which jobs did that time go to" — and the two are not the
 * same number. A technician's job time does NOT have to sum to his shift: driving between calls is
 * paid and belongs to no job, and a shop-day is paid and has no visit at all. Any code that makes
 * these reconcile has misunderstood both.
 *
 * The stamps already exist and cost the technician nothing extra: he taps Arrived because the
 * customer wants to know the plumber is here, and Done because that is how the job moves. A second
 * job clock would be a second punch for the same moment, and the second punch is the one people
 * forget (see modules/jobs/domain/labor-rollup.ts, which applies the same rule for costing).
 *
 * TIMES ARE INSTANTS, NEVER WALL CLOCKS. See `startedAt` below — rendering them in SQL puts them in
 * the database's timezone, which is nobody's.
 *
 * MEASURED ONLY. The costing rollup falls back to a visit's BOOKED length when nobody tapped,
 * because a cost report needs a number for every visit. This surface must not: showing a man a
 * scheduled estimate on his own timesheet, in the same column as time he actually recorded, is
 * presenting a guess as his own statement. A visit with no stamps comes back with nulls and the UI
 * says so.
 *
 * Ordinary shape: an office-created visit nobody has arrived at yet returns start/end null. That is
 * correct and common, not an error.
 */

export interface VisitStamp {
  readonly visitId: string;
  readonly jobId: string;
  /** The job's number, e.g. "JOB-1042" — what the technician calls it out loud. */
  readonly jobNum: string;
  readonly jobTitle: string | null;
  /** Who the work was for. Null when the job has no customer record attached. */
  readonly customerName: string | null;
  /** The day this belongs to: its scheduled date, else the day it was finished. */
  readonly workDate: string;
  /**
   * Arrived, as an ISO INSTANT — not a wall clock. Null when nobody tapped.
   *
   * `to_char(started_at, 'HH24:MI')` renders in the database session's timezone, which is UTC, so a
   * technician who arrived at eight in the morning in California read "3p" on his own timesheet.
   * The instant is the fact; the wall clock is a rendering, and the only device that knows which
   * wall clock he means is the one in his hand. Same shape the rest of the app returns these stamps
   * in (`iso(v.startedAt)` in modules/jobs/api/job-dto.ts).
   */
  readonly startedAt: string | null;
  /** Done, as an ISO instant. Null while the visit is still running, or when nobody tapped. */
  readonly completedAt: string | null;
}

/**
 * The day a visit's activity belongs to — its booked day, else the day it was finished.
 *
 * Written against the query's own alias rather than the drizzle column objects, which render as
 * `"job_visits"."scheduled_date"` and do not resolve inside a statement whose FROM aliases the
 * table `v`. That mistake makes Postgres reject the whole query, which surfaces as an EMPTY panel
 * indistinguishable from a week with no visits — the same trap documented in
 * drizzle-unreported-days-reader.ts.
 */
const VISIT_DAY = `coalesce(v.scheduled_date, v.completed_at::date)`;

export class DrizzleVisitStampsReader {
  constructor(
    private readonly tx: TenantTx,
    private readonly orgId: OrgId,
  ) {}

  /** One person's visits in [from, to], in the order the days and the taps happened. */
  async find(from: string, to: string, userId: UserId): Promise<VisitStamp[]> {
    const rows = await this.tx.execute<{
      visit_id: string;
      job_id: string;
      job_num: string;
      job_title: string | null;
      customer_name: string | null;
      day: string;
      started_at: Date | null;
      completed_at: Date | null;
    }>(sql`
      SELECT
        v.id                                        AS visit_id,
        v.job_id                                    AS job_id,
        j.num                                       AS job_num,
        j.title                                     AS job_title,
        l.name                                      AS customer_name,
        ${sql.raw(VISIT_DAY)}                                 AS day,
        v.started_at                                AS started_at,
        v.completed_at                              AS completed_at
      FROM job_visits v
      JOIN jobs j ON j.org_id = v.org_id AND j.id = v.job_id
      -- LEFT: a job whose customer record was archived still has hours worth showing.
      LEFT JOIN leads l ON l.org_id = j.org_id AND l.id = j.lead_id
      WHERE v.org_id = ${this.orgId}
        AND v.assignee_user_id = ${userId}
        AND v.deleted_at IS NULL
        AND j.deleted_at IS NULL
        AND v.status <> 'canceled'
        AND ${sql.raw(VISIT_DAY)} BETWEEN ${from} AND ${to}
      ORDER BY ${sql.raw(VISIT_DAY)} ASC, v.started_at ASC NULLS LAST, v.position ASC
    `);

    return rows.map((r) => ({
      visitId: r.visit_id,
      jobId: r.job_id,
      jobNum: r.job_num,
      jobTitle: r.job_title,
      customerName: r.customer_name,
      workDate: r.day,
      startedAt: r.started_at ? new Date(r.started_at).toISOString() : null,
      completedAt: r.completed_at ? new Date(r.completed_at).toISOString() : null,
    }));
  }
}
