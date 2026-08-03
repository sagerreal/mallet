import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { jobs, jobVisits } from "@mallet/shared/db/schema";
import type { TenantTx } from "@mallet/shared/db/tx";
import type { OrgId, JobId } from "@mallet/shared/types";
import { DEFAULT_VISIT_DURATION_MINUTES } from "../domain/job";
import type { AdoptEstimatePatch } from "../domain/job-repository";

/**
 * The convert-on-accept SQL, extracted from DrizzleJobRepository.adoptEstimateOnJob (which owns
 * the transaction story and the line swap). Two statements, one job:
 *
 * flipScopeVisitJob — the single UPDATE that turns a walkthrough into the sold work. The WHERE
 * is the whole guard: `kind = 'estimate'` refuses anything already sold — under a concurrent
 * double-accept the second UPDATE matches zero rows and returns false, and the caller's mint
 * fallback then hits the findBySourceEstimate/ON CONFLICT idempotency instead of seeding a
 * second visit. Canceled walkthroughs are refused too: converting one would resurrect a job
 * somebody explicitly killed, when minting a fresh one loses nothing.
 *
 * The lifecycle RESETS alongside the kind flip (status='scheduled', stamps cleared): a completed
 * walkthrough left status='complete' would put the freshly sold job straight into "Done, not
 * billed" — money on the floor for work that has not happened. The walkthrough visit keeps its
 * own stamps; history lives on the visit, the job is live work again.
 */
export async function flipScopeVisitJob(
  tx: TenantTx,
  orgId: OrgId,
  jobId: JobId,
  patch: AdoptEstimatePatch,
  now: Date,
): Promise<boolean> {
  const flipped = await tx
    .update(jobs)
    .set({
      kind: "work",
      sourceEstimateId: patch.sourceEstimateId,
      totalCents: patch.totalCents,
      taxBps: patch.taxBps,
      taxCents: patch.taxCents,
      title: patch.title,
      // Mint sets svc null on estimate-sourced work; convert matches it. A voice-booked
      // walkthrough parks the spoken service name here, and isEstimateJob's legacy fallback
      // reads svc — leaving it set would keep the converted job rendering as an estimate.
      svc: null,
      status: "scheduled",
      startedAt: null,
      completedAt: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(jobs.id, jobId),
        eq(jobs.orgId, orgId),
        eq(jobs.kind, "estimate"),
        ne(jobs.status, "canceled"),
        isNull(jobs.deletedAt),
      ),
    )
    .returning({ id: jobs.id });
  return flipped.length > 0;
}

/**
 * ONE pending work visit, appended AFTER the walkthrough history (max position + 1). The id
 * comes from the column default; duration matches the mint path's seeded default, for the same
 * reason — the job modal always shows an editable Length row backed by persisted data.
 */
export async function appendPendingVisit(
  tx: TenantTx,
  orgId: OrgId,
  jobId: JobId,
  now: Date,
): Promise<void> {
  const posRows = await tx
    .select({ maxPos: sql<number>`coalesce(max(${jobVisits.position}), 0)::int` })
    .from(jobVisits)
    .where(and(eq(jobVisits.orgId, orgId), eq(jobVisits.jobId, jobId), isNull(jobVisits.deletedAt)));
  await tx.insert(jobVisits).values({
    orgId,
    jobId,
    assigneeUserId: null,
    scheduledDate: null,
    scheduledStart: null,
    scheduledEnd: null,
    durationMinutes: DEFAULT_VISIT_DURATION_MINUTES,
    status: "pending",
    notes: null,
    position: (posRows[0]?.maxPos ?? 0) + 1,
    createdAt: now,
    updatedAt: now,
  });
}
