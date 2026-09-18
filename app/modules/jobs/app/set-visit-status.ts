import type { JobId, VisitId, Result, AppError, Clock } from "@mallet/shared/types";
import { notFound, validation, ok, err, isOk } from "@mallet/shared/types";
import type { EventBus } from "@mallet/shared/ports";
import { JobVisit, type VisitStatus, type JobVisitProps } from "../domain/job";
import type { JobRepository } from "../domain/job-repository";
import { NO_COST_RATES, type CostRateReader } from "../domain/cost-rate-reader";
import type { Job } from "../domain/job";

export interface SetVisitStatusCommand {
  readonly jobId: JobId;
  readonly visitId: VisitId;
  readonly status: VisitStatus;
}

// Allowed transitions:
//   pending      → in_progress | complete | canceled
//   in_progress  → complete    | canceled
//   complete     → pending     (the field "↩ Reopen"; clears completedAt)
//   canceled     → (terminal, no transitions)
//
// pending → complete is deliberate: the field UI's "✓ Mark done" is ungated (a tech
// may finish without ever tapping On my way / Arrived) — startedAt simply stays null
// on that path.
const ALLOWED_TRANSITIONS: Record<VisitStatus, readonly VisitStatus[]> = {
  pending: ["in_progress", "complete", "canceled"],
  in_progress: ["complete", "canceled"],
  complete: ["pending"],
  canceled: [],
};

type VisitStamps = Pick<JobVisitProps, "startedAt" | "completedAt" | "enrouteAt">;

// The three timestamps a transition owns, as one table rather than three ternaries buried in
// exec(). "pending" is only reachable from "complete" (the ↩ Reopen button), so it is the single
// clearing case — and a reopened visit is a FRESH trip, which is why enrouteAt clears with
// completedAt. Leaving the old departure stamp behind would make the reopened visit read back as
// enroute (pending + a stamp) and hand the clock travel time from a trip that already ended.
const stampsFor = (status: VisitStatus, current: JobVisitProps, now: Date): VisitStamps => ({
  startedAt: status === "in_progress" ? now : current.startedAt,
  completedAt: status === "complete" ? now : status === "pending" ? null : current.completedAt,
  enrouteAt: status === "pending" ? null : current.enrouteAt,
});

// Applies the visit transition, then derives the JOB status from the resulting visit
// set so the client's optimistic recalc and the server agree (no flash-then-revert):
//   - every ACTIVE (non-canceled) visit complete → the job completes (job.completed emits)
//   - a visit reopened on a complete job        → the job returns to in_progress
export class SetVisitStatusUseCase {
  constructor(
    private readonly repo: JobRepository,
    private readonly bus: EventBus,
    private readonly clock: Clock,
    /**
     * Optional, and it defaults to "no rates known" on purpose. A dozen call sites construct this
     * use-case to MOVE A VISIT and have nothing to do with money; forcing each to wire a database
     * reader would be a required dependency added for one branch of one transition. Omitted, the
     * stamp is null and costing keeps reading the person's current rate — the pre-snapshot
     * behaviour, unchanged.
     */
    private readonly costRates: CostRateReader = NO_COST_RATES,
  ) {}

  async exec(cmd: SetVisitStatusCommand): Promise<Result<Job, AppError>> {
    const job = await this.repo.findById(cmd.jobId);
    if (!job) return err(notFound("job"));

    const existing = job.props.visits;
    const idx = existing.findIndex((v) => v.props.id === cmd.visitId);
    if (idx === -1) return err(notFound("visit"));

    const visit = existing[idx];
    if (!visit) return err(notFound("visit"));

    const currentStatus = visit.props.status;

    if (currentStatus === cmd.status) {
      // Idempotent: same status requested — no-op, return current job.
      return ok(job);
    }

    const allowed = ALLOWED_TRANSITIONS[currentStatus];
    if (!allowed.includes(cmd.status)) {
      return err(
        validation(
          `cannot transition visit from "${currentStatus}" to "${cmd.status}"`,
          "status",
        ),
      );
    }

    const now = this.clock.now();

    /**
     * THE COST OF AN HOUR IS FIXED WHEN THE HOUR IS WORKED.
     *
     * Read at COMPLETION and only at completion. Costing used to multiply hours by whatever the
     * person costs today, so the week somebody got a raise, every week they had ever worked
     * re-priced itself. Stamping here is what stops history moving.
     *
     * Reopening clears it, exactly as it clears completedAt: a reopened visit has not finished, so
     * it has no settled cost, and leaving the old figure behind would price the NEXT trip at the
     * rate of the one that was undone.
     */
    const costRateCents =
      cmd.status === "complete"
        ? visit.props.assigneeUserId
          ? await this.costRates.rateFor(visit.props.assigneeUserId)
          : null
        : cmd.status === "pending"
          ? null
          : (visit.props.costRateCents ?? null);

    const newProps = {
      ...visit.props,
      status: cmd.status,
      costRateCents,
      ...stampsFor(cmd.status, visit.props, now),
    };

    const updated = JobVisit.create(newProps);
    if (!isOk(updated)) return updated;

    const newVisits = existing.map((v, i) => (i === idx ? updated.value : v));

    // A complete job must reopen BEFORE the visit write (withVisits refuses terminal
    // jobs); it is re-completed below if the visit set still ends up all-complete.
    // A CANCELED job stays untouchable — withVisits rejects it as before.
    let current = job;
    if (current.props.status === "complete") {
      const reopened = current.reopen(now);
      if (!isOk(reopened)) return reopened;
      current = reopened.value;
    }

    const jobResult = current.withVisits(newVisits, now);
    if (!isOk(jobResult)) return jobResult;
    let result = jobResult.value;

    const active = newVisits.filter((v) => v.props.status !== "canceled");
    const allComplete = active.length > 0 && active.every((v) => v.props.status === "complete");

    if (allComplete && result.props.status !== "complete") {
      // The domain machine has no scheduled → complete edge; pass through start()
      // (the work evidently happened even if nobody tapped Start).
      if (result.props.status === "scheduled") {
        const started = result.start(now);
        if (!isOk(started)) return started;
        result = started.value;
      }
      const completed = result.complete(now);
      if (!isOk(completed)) return completed;
      result = completed.value;
    }

    await this.repo.save(result);

    if (result.props.status === "complete" && job.props.status !== "complete") {
      // Same event the office complete endpoint emits (CompleteJobUseCase) — the
      // Phase-2 ensure-an-invoice handler must fire for field-completed jobs too.
      await this.bus.emit({
        name: "job.completed",
        orgId: result.props.orgId,
        payload: { jobId: result.props.id, leadId: result.props.leadId },
        occurredAt: now,
      });
    }

    return ok(result);
  }
}
