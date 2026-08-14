import { and, eq, gte, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import type { TenantTx } from "@mallet/shared/db/tx";
import type { OrgId } from "@mallet/shared/types";
import { jobs, jobVisits } from "@mallet/shared/db/schema/jobs";
import { jobLines, jobAddons } from "@mallet/shared/db/schema/job-execution";
import { invoices } from "@mallet/shared/db/schema/invoices";
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

  /**
   * What the parts cost the shop, cents — job lines plus approved add-ons that are actually being
   * billed. Snapshotted onto the line when it was added, so re-pricing the pricebook never rewrites
   * a job that already happened.
   *
   * Zero when the job has no priced lines, which is a real answer: a service call with no parts
   * costs nothing in parts. That is different from labour, where null means "unknown".
   */
  readonly materialsCents: number;

  /**
   * What the customer was actually billed, EXCLUDING tax — null when nothing has been invoiced.
   *
   * Tax is collected for the state and passed straight through; counting it as revenue inflates
   * every margin by the tax rate. Null rather than 0 because "not invoiced yet" and "invoiced for
   * nothing" are different facts, and only one of them is a warranty callback.
   */
  readonly revenueCents: number | null;

  /**
   * The parent job when this one is a callback, else null.
   *
   * A warranty return has cost and no revenue, so it reads as a total loss on its own row. Shown
   * against the job it came back on, it is the thing that quietly ate that job's margin.
   */
  readonly callbackOf: string | null;

  /** Hours the visits were BOOKED for — the estimate actual hours are judged against. */
  readonly scheduledHours: number;
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
        /**
         * THE SNAPSHOT FIRST, the person's current rate only as a fallback.
         *
         * `job_visits.cost_rate_cents` is stamped when the visit completes, so a raise stops
         * re-pricing every week already worked. The coalesce covers rows written before the stamp
         * existed and visits whose assignee had no rate at the time — for those the current rate
         * is the best available answer and is exactly the pre-snapshot behaviour.
         */
        costRateCents: sql<number | null>`coalesce(${jobVisits.costRateCents}, ${users.costRateCents})`,
        num: jobs.num,
        title: jobs.title,
        jobStatus: jobs.status,
        totalCents: jobs.totalCents,
        callbackOf: jobs.callbackOf,
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
    const rolled = rollUpLabor(labor).flatMap((job) => {
      const m = meta.get(job.jobId);
      if (!m) return [];
      return [{ job, m }];
    });
    if (rolled.length === 0) return [];

    // Materials and revenue are fetched for exactly the jobs that survived the rollup — two extra
    // round trips for the page rather than one per row.
    const jobIds = rolled.map((r) => r.job.jobId);
    const [materials, revenue, scheduled] = await Promise.all([
      this.materialsByJob(jobIds),
      this.revenueByJob(jobIds),
      this.scheduledHoursByJob(jobIds, from, to),
    ]);

    return rolled.map(({ job, m }) => ({
      ...job,
      num: m.num,
      title: m.title,
      customerName: m.customerName,
      quotedCents: m.totalCents,
      jobStatus: m.jobStatus,
      callbackOf: m.callbackOf,
      materialsCents: materials.get(job.jobId) ?? 0,
      revenueCents: revenue.get(job.jobId) ?? null,
      scheduledHours: scheduled.get(job.jobId) ?? 0,
    }));
  }

  /**
   * Parts cost per job: priced lines plus add-ons that are approved AND being billed.
   *
   * `invoice_skip` add-ons are deliberately excluded — an approved extra held off this bill has not
   * been paid for, and counting its cost against revenue that has not arrived reports a loss the
   * shop has not made. Declined and proposed add-ons never happened at all.
   */
  private async materialsByJob(jobIds: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    const lines = await this.tx
      .select({
        jobId: jobLines.jobId,
        cents: sql<number>`coalesce(sum(${jobLines.costCents} * ${jobLines.quantity}), 0)::int`,
      })
      .from(jobLines)
      .where(and(eq(jobLines.orgId, this.orgId), isNull(jobLines.deletedAt), inArray(jobLines.jobId, jobIds)))
      .groupBy(jobLines.jobId);
    for (const r of lines) out.set(r.jobId, r.cents);

    const addons = await this.tx
      .select({
        jobId: jobAddons.jobId,
        cents: sql<number>`coalesce(sum(${jobAddons.costCents} * ${jobAddons.quantity}), 0)::int`,
      })
      .from(jobAddons)
      .where(
        and(
          eq(jobAddons.orgId, this.orgId),
          isNull(jobAddons.deletedAt),
          inArray(jobAddons.jobId, jobIds),
          eq(jobAddons.status, "approved"),
          ne(jobAddons.invoiceSkip, true),
        ),
      )
      .groupBy(jobAddons.jobId);
    for (const r of addons) out.set(r.jobId, (out.get(r.jobId) ?? 0) + r.cents);

    return out;
  }

  /**
   * Billed revenue per job, EX TAX.
   *
   * `invoices.total_cents` is tax-INCLUSIVE by design, so tax comes back off: it is the state's
   * money passing through, and leaving it in inflates every margin by the tax rate. Voided invoices
   * are excluded — a void is the shop saying the bill never stood.
   */
  private async revenueByJob(jobIds: string[]): Promise<Map<string, number>> {
    const rows = await this.tx
      .select({
        jobId: invoices.sourceJobId,
        cents: sql<number>`coalesce(sum(${invoices.totalCents} - ${invoices.taxCents}), 0)::int`,
      })
      .from(invoices)
      .where(
        and(
          eq(invoices.orgId, this.orgId),
          isNull(invoices.deletedAt),
          ne(invoices.status, "void"),
          inArray(invoices.sourceJobId, jobIds),
        ),
      )
      .groupBy(invoices.sourceJobId);
    const out = new Map<string, number>();
    for (const r of rows) if (r.jobId) out.set(r.jobId, r.cents);
    return out;
  }

  /** Hours the visits in range were BOOKED for — what the actual hours are judged against. */
  private async scheduledHoursByJob(jobIds: string[], from: string, to: string): Promise<Map<string, number>> {
    const rows = await this.tx
      .select({
        jobId: jobVisits.jobId,
        minutes: sql<number>`coalesce(sum(${jobVisits.durationMinutes}), 0)::int`,
      })
      .from(jobVisits)
      .where(
        and(
          eq(jobVisits.orgId, this.orgId),
          isNull(jobVisits.deletedAt),
          ne(jobVisits.status, "canceled"),
          inArray(jobVisits.jobId, jobIds),
          gte(visitDay, from),
          lte(visitDay, to),
        ),
      )
      .groupBy(jobVisits.jobId);
    return new Map(rows.map((r) => [r.jobId, Math.round((r.minutes / 60) * 100) / 100]));
  }
}
