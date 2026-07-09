import type { JobId, UserId, VisitId, Result, AppError, Clock } from "@mallet/shared/types";
import { notFound, ok, err, isOk } from "@mallet/shared/types";
import { JobVisit } from "../domain/job";
import type { JobRepository } from "../domain/job-repository";
import type { Job } from "../domain/job";

export interface PatchVisitScheduleCommand {
  readonly jobId: JobId;
  readonly visitId: VisitId;
  // All fields are optional — only provided fields are changed.
  readonly assigneeUserId?: UserId | null;
  readonly scheduledDate?: string | null;
  readonly scheduledStart?: string | null;
  readonly scheduledEnd?: string | null;
  readonly notes?: string | null;
}

// Partial update of a visit's scheduling fields. Does not recompute duration — use
// UpdateVisitDuration for that. Useful for clearing date/assignee (unplace) or adjusting notes.
export class PatchVisitScheduleUseCase {
  constructor(
    private readonly repo: JobRepository,
    private readonly clock: Clock,
  ) {}

  async exec(cmd: PatchVisitScheduleCommand): Promise<Result<Job, AppError>> {
    const job = await this.repo.findById(cmd.jobId);
    if (!job) return err(notFound("job"));

    const existing = job.props.visits;
    const idx = existing.findIndex((v) => v.props.id === cmd.visitId);
    if (idx === -1) return err(notFound("visit"));

    const existingVisit = existing[idx];
    if (!existingVisit) return err(notFound("visit"));

    const prev = existingVisit.props;
    const updated = JobVisit.create({
      ...prev,
      assigneeUserId: cmd.assigneeUserId !== undefined ? cmd.assigneeUserId : prev.assigneeUserId,
      scheduledDate: cmd.scheduledDate !== undefined ? cmd.scheduledDate : prev.scheduledDate,
      scheduledStart: cmd.scheduledStart !== undefined ? cmd.scheduledStart : prev.scheduledStart,
      scheduledEnd: cmd.scheduledEnd !== undefined ? cmd.scheduledEnd : prev.scheduledEnd,
      notes: cmd.notes !== undefined ? cmd.notes : prev.notes,
    });
    if (!isOk(updated)) return updated;

    const newVisits = existing.map((v, i) => (i === idx ? updated.value : v));
    const jobResult = job.withVisits(newVisits, this.clock.now());
    if (!isOk(jobResult)) return jobResult;

    await this.repo.save(jobResult.value);
    return ok(jobResult.value);
  }
}
