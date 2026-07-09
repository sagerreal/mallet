import type { JobId, VisitId, Result, AppError, Clock } from "@mallet/shared/types";
import { notFound, validation, ok, err, isOk } from "@mallet/shared/types";
import { JobVisit, type VisitStatus } from "../domain/job";
import type { JobRepository } from "../domain/job-repository";
import type { Job } from "../domain/job";

export interface SetVisitStatusCommand {
  readonly jobId: JobId;
  readonly visitId: VisitId;
  readonly status: VisitStatus;
}

// Allowed transitions:
//   pending      → in_progress | canceled
//   in_progress  → complete    | canceled
//   complete     → (terminal, no transitions)
//   canceled     → (terminal, no transitions)
const ALLOWED_TRANSITIONS: Record<VisitStatus, readonly VisitStatus[]> = {
  pending: ["in_progress", "canceled"],
  in_progress: ["complete", "canceled"],
  complete: [],
  canceled: [],
};

export class SetVisitStatusUseCase {
  constructor(
    private readonly repo: JobRepository,
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
      completedAt: cmd.status === "complete" ? now : visit.props.completedAt,
    };

    const updated = JobVisit.create(newProps);
    if (!isOk(updated)) return updated;

    const newVisits = existing.map((v, i) => (i === idx ? updated.value : v));
    const jobResult = job.withVisits(newVisits, now);
    if (!isOk(jobResult)) return jobResult;

    await this.repo.save(jobResult.value);
    return ok(jobResult.value);
  }
}
