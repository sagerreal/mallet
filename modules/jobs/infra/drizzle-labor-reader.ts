import { and, eq, gte, inArray, isNotNull, isNull, lte, ne, sql } from "drizzle-orm";
import type { TenantTx } from "@mallet/shared/db/tx";
import type { OrgId } from "@mallet/shared/types";
import { jobs, jobVisits } from "@mallet/shared/db/schema/jobs";
import { jobLines, jobAddons } from "@mallet/shared/db/schema/job-execution";
import { invoices } from "@mallet/shared/db/schema/invoices";
import { leads } from "@mallet/shared/db/schema/leads";
import { users } from "@mallet/shared/db/schema/users";
import { timeEntries } from "@mallet/shared/db/schema/time-entries";
import { rollUpLabor, type LaborVisit, type JobLabor } from "../domain/labor-rollup";

/**
 * modules/jobs/infra/drizzle-labor-reader.ts
 * What a week of work COST, read off the hours people reported against jobs.
 *
 * THE TIMESHEET IS THE SOURCE OF LABOUR. There is no clock: a person enters their day as blocks
 * of Regular, Job or Break time, names the job on the job blocks, and submits it. The job blocks
 * ARE the labour, so a costed hour and a paid hour are the same row and cannot disagree — which
 * is the failure mode of every design where the clock and the costing are captured separately.
 *
 * Only `kind = 'job'` contributes. Regular is paid working time nobody attributed, Break is not
 * paid work at all, and time off has no job — none of them belong in a job's cost.
 *
 * The rate is the person's CURRENT burdened rate. A visit-stamped snapshot used to freeze it at
 * completion; a hand-entered timesheet has no equivalent moment, so a raise re-prices past weeks
 * until somebody asks for a snapshot.
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

/**
 * A time entry's two instants, composed in JS from the stored `YYYY-MM-DD` and `HH:MM:SS`.
 *
 * Deliberately NOT `work_date + start_time` in SQL: that yields a `timestamp` the driver hands
 * back as a string, and casting it to timestamptz would resolve it in the DATABASE's zone rather
 * than the van's — the same trap that once had a timesheet rendering 4am shifts. Only the SPAN is
 * ever used, and both ends are built the same way, so the difference is exact whatever the zone.
 *
 * Returns null when either half is missing (a running row has no end). An end before its start —
 * a shift across midnight, or a typo — makes a negative span, which visitLabor() already refuses
 * rather than subtracting from a job's cost.
 */
const instant = (workDate: string, hhmmss: string | null): Date | null => {
  if (hhmmss === null) return null;
  const at = new Date(`${workDate}T${hhmmss}`);
  return Number.isNaN(at.getTime()) ? null : at;
};

export class DrizzleLaborReader {
  constructor(
    private readonly tx: TenantTx,
    private readonly orgId: OrgId,
  ) {}

  /** Per-job labour for visits falling in [from, to], inclusive. Both dates are `YYYY-MM-DD`. */
  async byJob(from: string, to: string): Promise<JobLaborRow[]> {
    const rows = await this.tx
      .select({
        jobId: timeEntries.jobId,
        workDate: timeEntries.workDate,
        startTime: timeEntries.startTime,
        endTime: timeEntries.endTime,
        // A hand-entered block has no booked length to fall back on — the entry IS the claim.
        durationMinutes: sql<number | null>`null::int`,
        costRateCents: users.costRateCents,
        num: jobs.num,
        title: jobs.title,
        jobStatus: jobs.status,
        totalCents: jobs.totalCents,
        callbackOf: jobs.callbackOf,
        customerName: leads.name,
      })
      .from(timeEntries)
      .innerJoin(jobs, and(eq(jobs.id, timeEntries.jobId), eq(jobs.orgId, timeEntries.orgId)))
      .innerJoin(leads, and(eq(leads.id, jobs.leadId), eq(leads.orgId, jobs.orgId)))
      // INNER, unlike the visit reader's LEFT join: a time entry always has an author, so a
      // missing user row is corruption rather than the ordinary unassigned case.
      .innerJoin(users, and(eq(users.id, timeEntries.techUserId), eq(users.orgId, timeEntries.orgId)))
      .where(
        and(
          eq(timeEntries.orgId, this.orgId),
          isNull(timeEntries.deletedAt),
          isNull(jobs.deletedAt),
          // Only job time is a job's cost. Regular is unattributed paid work, Break is not work,
          // and time-off kinds have no job at all.
          eq(timeEntries.kind, "job"),
          // A running row has no end and therefore no length — it would read as a negative span.
          isNotNull(timeEntries.endTime),
          gte(timeEntries.workDate, from),
          lte(timeEntries.workDate, to),
        ),
      );

    // jobId is nullable on the column (Regular/Break carry none) but the inner join to jobs plus
    // the kind = 'job' filter mean every surviving row has one; the guard is for the type, and
    // drops anything pathological rather than passing a null through as a job key.
    const labor: LaborVisit[] = rows.flatMap((r) =>
      r.jobId === null
        ? []
        : [
            {
              jobId: r.jobId,
              startedAt: instant(r.workDate, r.startTime),
              completedAt: instant(r.workDate, r.endTime),
              durationMinutes: r.durationMinutes,
              // An entry with both times IS the finished claim — there is no separate "did it
              // finish" state on a timesheet row the way a visit has one.
              complete: true,
              costRateCents: r.costRateCents,
            },
          ],
    );

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
