import type { JobId, VisitId, Result, AppError, Clock } from "@mallet/shared/types";
import { notFound, validation, ok, err, isOk } from "@mallet/shared/types";
import type { EventBus } from "@mallet/shared/ports";
import { JobVisit, type VisitStatus } from "../domain/job";
import type { JobRepository } from "../domain/job-repository";
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

// Applies the visit transition, then derives the JOB status from the resulting visit
// set so the client's optimistic recalc and the server agree (no flash-then-revert):
//   - every ACTIVE (non-canceled) visit complete → the job completes (job.completed emits)
//   - a visit reopened on a complete job        → the job returns to in_progress
export class SetVisitStatusUseCase {
  constructor(
    private readonly repo: JobRepository,
    private readonly bus: EventBus,
    private readonly clock: Clock,
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
    const newProps = {
      ...visit.props,
      status: cmd.status,
      startedAt: cmd.status === "in_progress" ? now : visit.props.startedAt,
      // "pending" is only reachable from "complete" (reopen) — clear the stamp there.
      completedAt:
        cmd.status === "complete" ? now : cmd.status === "pending" ? null : visit.props.completedAt,
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
