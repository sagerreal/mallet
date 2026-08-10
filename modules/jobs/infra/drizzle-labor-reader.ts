import { and, eq, gte, isNull, lte, ne, sql } from "drizzle-orm";
import type { TenantTx } from "@mallet/shared/db/tx";
import type { OrgId } from "@mallet/shared/types";
import { jobs, jobVisits } from "@mallet/shared/db/schema/jobs";
import { leads } from "@mallet/shared/db/schema/leads";
import { users } from "@mallet/shared/db/schema/users";
import { rollUpLabor, type LaborVisit, type JobLabor } from "../domain/labor-rollup";

/**
 * modules/jobs/infra/drizzle-labor-reader.ts
 * What a week of work COST, read off the visits that were already recorded.
 *
 * Reads `job_visits`, never `jobs`. Both tables carry enroute/started/completed stamps, and the
 * job's are the wrong ones: a job has one set no matter how many trips it took, so costing a
 * three-visit job off them measures the last trip and calls it the job. One triple per visit row,
 * summed — which works identically at one visit or five.
 *
 * The cost rate comes from the visit's ASSIGNEE, not the caller and not the job's assignee: the
 * hour belongs to whoever ran that trip.
 */

/** A job's labour for the week, with enough about the job to name it on screen. */
export interface JobLaborRow extends JobLabor {
  readonly num: string;
  readonly title: string | null;
  readonly customerName: string;
  /** The agreed price, cents — tax-inclusive, as every total downstream of an estimate is. */
  readonly quotedCents: number;
  readonly jobStatus: string;
}

/**
 * WHICH WEEK A VISIT BELONGS TO — its booked day, falling back to the day it was finished.
 *
 * Booked day first, so a job stays in the week the shop planned it even if the technician closed
 * it out late that night. `completed_at` covers the visit that was never placed on the board and
 * got done anyway; it is a timestamptz, so the cast reads the DATABASE's zone rather than the
 * van's, which is the same approximation every other band on this screen already makes.
 */
const visitDay = sql`coalesce(${jobVisits.scheduledDate}, ${jobVisits.completedAt}::date)`;

export class DrizzleLaborReader {
  constructor(
    private readonly tx: TenantTx,
    private readonly orgId: OrgId,
  ) {}

  /** Per-job labour for visits falling in [from, to], inclusive. Both dates are `YYYY-MM-DD`. */
  async byJob(from: string, to: string): Promise<JobLaborRow[]> {
    const rows = await this.tx
      .select({
        jobId: jobVisits.jobId,
        startedAt: jobVisits.startedAt,
        completedAt: jobVisits.completedAt,
        durationMinutes: jobVisits.durationMinutes,
        status: jobVisits.status,
        costRateCents: users.costRateCents,
        num: jobs.num,
        title: jobs.title,
        jobStatus: jobs.status,
        totalCents: jobs.totalCents,
        customerName: leads.name,
      })
      .from(jobVisits)
      .innerJoin(jobs, and(eq(jobs.id, jobVisits.jobId), eq(jobs.orgId, jobVisits.orgId)))
      .innerJoin(leads, and(eq(leads.id, jobs.leadId), eq(leads.orgId, jobs.orgId)))
      // LEFT, deliberately: an unassigned visit still happened and its hours still count. Losing
      // it would make a job look cheaper than it was, which is the one direction a costing report
      // must never be wrong in.
      .leftJoin(users, and(eq(users.id, jobVisits.assigneeUserId), eq(users.orgId, jobVisits.orgId)))
      .where(
        and(
          eq(jobVisits.orgId, this.orgId),
          isNull(jobVisits.deletedAt),
          isNull(jobs.deletedAt),
          // Nobody travelled and nobody worked.
          ne(jobVisits.status, "canceled"),
          gte(visitDay, from),
          lte(visitDay, to),
        ),
      );

    const labor: LaborVisit[] = rows.map((r) => ({
      jobId: r.jobId,
      startedAt: r.startedAt,
      completedAt: r.completedAt,
      durationMinutes: r.durationMinutes,
      complete: r.status === "complete",
      costRateCents: r.costRateCents,
    }));

    // The rollup drops jobs whose visits all contributed nothing, so the join back is by lookup
    // rather than by zip — the two lists are not the same length.
    const meta = new Map(rows.map((r) => [r.jobId, r]));
    return rollUpLabor(labor).flatMap((job) => {
      const m = meta.get(job.jobId);
      if (!m) return [];
      return [{
        ...job,
        num: m.num,
        title: m.title,
        customerName: m.customerName,
        quotedCents: m.totalCents,
        jobStatus: m.jobStatus,
      }];
    });
  }
}
