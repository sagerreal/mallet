import type { JobId, VisitId, Result, AppError, Clock } from "@mallet/shared/types";
import { notFound, validation, ok, err, isOk } from "@mallet/shared/types";
import { JobVisit } from "../domain/job";
import type { JobRepository } from "../domain/job-repository";
import type { Job } from "../domain/job";

export interface UpdateVisitDurationCommand {
  readonly jobId: JobId;
  readonly visitId: VisitId;
  readonly durationHours: number; // positive, max 24
}

// Recompute scheduledEnd from the existing scheduledStart + new durationHours.
// If the visit is not yet placed (no start), the end stays null.
const recomputeEnd = (start: string | null, durationHours: number): string | null => {
  if (start === null) return null;
  const parts = start.split(":");
  const startMinutes = parseInt(parts[0] ?? "0", 10) * 60 + parseInt(parts[1] ?? "0", 10);
  const endMinutes = startMinutes + Math.round(durationHours * 60);
  if (endMinutes > 24 * 60) return null;
  const endH = Math.floor(endMinutes / 60);
  const endM = endMinutes % 60;
  return `${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}`;
};

export class UpdateVisitDurationUseCase {
  constructor(
    private readonly repo: JobRepository,
    private readonly clock: Clock,
  ) {}

  async exec(cmd: UpdateVisitDurationCommand): Promise<Result<Job, AppError>> {
    const job = await this.repo.findById(cmd.jobId);
    if (!job) return err(notFound("job"));

    const existing = job.props.visits;
    const idx = existing.findIndex((v) => v.props.id === cmd.visitId);
    if (idx === -1) return err(notFound("visit"));

    const visit = existing[idx];
    if (!visit) return err(notFound("visit"));

    const newEnd = recomputeEnd(visit.props.scheduledStart, cmd.durationHours);

    if (visit.props.scheduledStart !== null && newEnd === null) {
      return err(validation("start + duration exceeds midnight", "durationHours"));
    }

    const updated = JobVisit.create({
      ...visit.props,
      scheduledEnd: newEnd,
    });
    if (!isOk(updated)) return updated;

    const newVisits = existing.map((v, i) => (i === idx ? updated.value : v));
    const jobResult = job.withVisits(newVisits, this.clock.now());
    if (!isOk(jobResult)) return jobResult;

    await this.repo.save(jobResult.value);
    return ok(jobResult.value);
  }
}
