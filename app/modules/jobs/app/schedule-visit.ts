import type { JobId, UserId, VisitId, Result, AppError, Clock } from "@mallet/shared/types";
import { notFound, validation, ok, err, isOk } from "@mallet/shared/types";
import { JobVisit } from "../domain/job";
import type { JobRepository } from "../domain/job-repository";
import type { Job } from "../domain/job";

export interface ScheduleVisitCommand {
  readonly jobId: JobId;
  readonly visitId: VisitId;
  readonly assigneeUserId: UserId;
  readonly scheduledDate: string; // "YYYY-MM-DD"
  readonly scheduledStart: string; // "HH:MM"
  readonly durationHours: number; // positive, max 24
}

// Compute an "HH:MM" end time from a "HH:MM" start and duration in hours.
const computeEnd = (start: string, durationHours: number): string | null => {
  const parts = start.split(":");
  const startMinutes = parseInt(parts[0] ?? "0", 10) * 60 + parseInt(parts[1] ?? "0", 10);
  const endMinutes = startMinutes + Math.round(durationHours * 60);
  if (endMinutes > 24 * 60) return null;
  const endH = Math.floor(endMinutes / 60);
  const endM = endMinutes % 60;
  return `${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}`;
};

// Place (or move) a visit: set assignee + date + start + compute end from durationHours.
// Flips an unplaced visit to placed; also moves an already-placed visit.
export class ScheduleVisitUseCase {
  constructor(
    private readonly repo: JobRepository,
    private readonly clock: Clock,
  ) {}

  async exec(cmd: ScheduleVisitCommand): Promise<Result<Job, AppError>> {
    const job = await this.repo.findById(cmd.jobId);
    if (!job) return err(notFound("job"));

    const existing = job.props.visits;
    const idx = existing.findIndex((v) => v.props.id === cmd.visitId);
    if (idx === -1) return err(notFound("visit"));

    const scheduledEnd = computeEnd(cmd.scheduledStart, cmd.durationHours);
    if (scheduledEnd === null) {
      return err(validation("start + duration exceeds midnight", "scheduledEnd"));
    }

    const existingVisit = existing[idx];
    if (!existingVisit) return err(notFound("visit"));

    const updated = JobVisit.create({
      ...existingVisit.props,
      assigneeUserId: cmd.assigneeUserId,
      scheduledDate: cmd.scheduledDate,
      scheduledStart: cmd.scheduledStart,
      scheduledEnd,
      // Keep the explicit length in sync with the start→end window this placement
      // creates — durationMinutes is the authoritative duration at read time.
      durationMinutes: Math.round(cmd.durationHours * 60),
    });
    if (!isOk(updated)) return updated;

    const newVisits = existing.map((v, i) => (i === idx ? updated.value : v));
    const jobResult = job.withVisits(newVisits, this.clock.now());
    if (!isOk(jobResult)) return jobResult;

    await this.repo.save(jobResult.value);
    return ok(jobResult.value);
  }
}
