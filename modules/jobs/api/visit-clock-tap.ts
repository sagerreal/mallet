import type { TenantTx } from "@mallet/shared/db/tx";
import type { Principal } from "@mallet/identity";
import type { Clock, JobId } from "@mallet/shared/types";
import type { IdGenerator } from "@mallet/shared/ports";
import { logger } from "@mallet/shared/observability";
import { DrizzleSettingsRepository } from "@mallet/settings";
import { DrizzleTimeEntryRepository, SetClockStateUseCase, type ClockTap } from "@mallet/timesheets";
import type { VisitStatus } from "../domain/job";

/**
 * Turning a technician's dispatch taps into timesheet hours.
 *
 * The three buttons on the field visit row already exist for another reason — the customer wants
 * to know the plumber is coming — so job attribution costs the technician nothing extra. This
 * module is the seam where a visit write becomes a clock segment.
 */

// Whose taps move a clock is a question about WORK, not about role.
//
// This was `role === "tech"`, which was wrong for the beachhead: in a 1-3 technician shop the owner
// is usually a working technician, so half the jobs are theirs. Recording none of that time left job
// costing unable to answer the only question it exists for — did we make money on that job.
//
// But the naive fix (drop the role check) is also wrong, and that is what the role check was
// papering over: assertOnJobIfTech waves owner/office through with NO assignment check at all, so an
// owner marking a technician's visit done from the field surface would have that technician's work
// filed as the owner's hours.
//
// So the rule is assignment: the caller's clock moves when the caller is the person the work belongs
// to. An owner-operator tapping Done on their own visit gets job time; an owner clearing a
// colleague's visit from the office is DISPATCHING and gets none. Same primitive the authorisation
// guard uses (Job.isAssignedToVisit / isAssignedTo), so the two can never disagree.

/**
 * The visit statuses the FIELD surface may set — the two step buttons on the tech's visit row.
 *
 * The other two are office corrections and are deliberately unreachable from here. `pending` is
 * the ↩ Reopen button: a correction made days later to a visit that already ended, and re-opening
 * it must never rewrite hours a technician already worked and may already have had approved.
 * `canceled` is a call-off — nobody travelled and nobody worked.
 */
export const FIELD_VISIT_STATUSES = ["in_progress", "complete"] as const satisfies readonly VisitStatus[];

export type FieldVisitStatus = (typeof FIELD_VISIT_STATUSES)[number];

/**
 * What each of those two buttons means to the clock. Total by construction — every status the
 * field surface can send moves the clock, so there is no silent "this one does nothing" case.
 */
export const CLOCK_TAP_FOR_STATUS: Record<FieldVisitStatus, ClockTap> = {
  // Arrived: close the drive, start job time on this job.
  in_progress: "arrived",
  // ✓ Mark done: close job time and auto-resume unassigned shop time, so the technician stays on
  // the clock between calls.
  complete: "done",
};

export interface ClockTapContext {
  /** The request's org transaction — the visit write is already in it. */
  readonly tx: TenantTx;
  readonly principal: Principal;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

/**
 * Run one clock tap alongside a visit write, and NEVER let it fail that write.
 *
 * The tap runs in the caller's transaction so hours and the visit can never disagree — a
 * committed "Arrived" with no travel segment behind it is a timesheet nobody can reconstruct.
 * But the visit write is a DISPATCH action a customer is waiting on, and payroll bookkeeping is
 * not worth failing it: a plumber standing in a crawlspace must be able to tell the office he is
 * on site even if the timesheet write is broken. So the tap gets its own SAVEPOINT and every
 * failure is swallowed into the log.
 *
 * The trade in one line: a lost clock segment costs job-cost attribution, which the office can
 * repair on the timesheet; a failed tap costs the customer their ETA, which nobody can repair.
 * (Hours themselves are still bounded by the day punch — see the timesheet plan.)
 *
 * `planTap` is total by design, so the realistic failures are a refusal the domain returns (an
 * unknown org timezone, a running entry dated wrong) rather than a throw. The savepoint covers
 * the rest: it is what lets a thrown database error roll back the tap alone and leave the
 * transaction holding the visit write committable.
 */
export const runVisitClockTap = async (
  ctx: ClockTapContext,
  tap: ClockTap,
  jobId: JobId,
  /**
   * Is this the caller's own work? The caller loaded the job to authorise the write, so it passes
   * the answer down rather than making this re-read it. False means DISPATCHING — somebody moving
   * another person's visit — and dispatching records no hours for the dispatcher.
   */
  isOwnWork: boolean,
): Promise<void> => {
  if (!isOwnWork) return;

  const orgId = ctx.principal.orgId;
  const techUserId = ctx.principal.userId;

  try {
    await ctx.tx.transaction(async (savepoint) => {
      // The shop's zone is read HERE and injected: timesheets must not import settings, and a
      // wrong zone files a plumber's evening on tomorrow's sheet, so it belongs where it can be
      // seen being passed in.
      const timeZone = await new DrizzleSettingsRepository(savepoint, orgId).getTimezone();
      const useCase = new SetClockStateUseCase(
        new DrizzleTimeEntryRepository(savepoint, orgId),
        ctx.clock,
        ctx.ids,
        timeZone,
      );
      const result = await useCase.exec(
        // Server time, not a device timestamp: nothing in this request carries one yet, and an
        // unbounded client-supplied instant is a backdating hole in a payroll record.
        { techUserId, tap, jobId, at: ctx.clock.now() },
        orgId,
      );
      if (!result.ok) {
        // A refusal writes nothing — every conversion is resolved before the first row — so there
        // is nothing to unwind. Logged rather than raised: the technician's tap succeeded.
        logger.warn(
          { orgId, techUserId, jobId, tap, reason: result.error },
          "job_visit.clock_tap_refused",
        );
      }
    });
  } catch (cause) {
    logger.error(
      { orgId, techUserId, jobId, tap, err: cause },
      "job_visit.clock_tap_failed",
    );
  }
};
