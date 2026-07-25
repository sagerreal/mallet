import type { JobId, UserId, Result, AppError, Clock } from "@mallet/shared/types";
import { notFound, ok, err, isOk } from "@mallet/shared/types";
import { asVisitId } from "@mallet/shared/types";
import type { IdGenerator } from "@mallet/shared/ports";
import { JobVisit } from "../domain/job";
import type { JobRepository } from "../domain/job-repository";
import type { Job } from "../domain/job";

export interface CreateVisitCommand {
  readonly jobId: JobId;
  readonly visitId?: string; // optional client-authored id; if provided, used as-is so the optimistic id === server row id
  readonly assigneeUserId: UserId | null;
  readonly scheduledDate: string | null;
  readonly scheduledStart: string | null;
  readonly durationHours: number; // positive, max 24
  readonly notes: string | null;
  /** Geocoded latitude (WGS84). Must be paired with lng; omit or null for no point. */
  readonly lat?: number | null;
  /** Geocoded longitude (WGS84). Must be paired with lat; omit or null for no point. */
  readonly lng?: number | null;
}

// Compute an "HH:MM" end time from a "HH:MM" start and duration in hours.
// Returns null if start is null or the result would overflow midnight.
const computeEnd = (start: string | null, durationHours: number): string | null => {
  if (start === null) return null;
  const parts = start.split(":");
  const startMinutes = parseInt(parts[0] ?? "0", 10) * 60 + parseInt(parts[1] ?? "0", 10);
  const endMinutes = startMinutes + Math.round(durationHours * 60);
  if (endMinutes > 24 * 60) return null; // overflow — caller must validate
  const endH = Math.floor(endMinutes / 60);
  const endM = endMinutes % 60;
  return `${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}`;
};

// Append a new unplaced (or placed, if date+assignee+start provided) visit onto a job.
// Position = max(existing positions) + 1, or 1 if no visits exist.
export class CreateVisitUseCase {
  constructor(
    private readonly repo: JobRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async exec(cmd: CreateVisitCommand): Promise<Result<Job, AppError>> {
    const job = await this.repo.findById(cmd.jobId);
    if (!job) return err(notFound("job"));

    const existing = job.props.visits;
    const position = existing.length === 0 ? 1 : Math.max(...existing.map((v) => v.props.position)) + 1;

    const scheduledEnd = computeEnd(cmd.scheduledStart, cmd.durationHours);

    const visitResult = JobVisit.create({
      id: cmd.visitId ? asVisitId(cmd.visitId) : asVisitId(this.ids.newId()),
      assigneeUserId: cmd.assigneeUserId,
      scheduledDate: cmd.scheduledDate,
      scheduledStart: cmd.scheduledStart,
      scheduledEnd,
      // Persist the length explicitly — an unplaced visit has no start/end window
      // to derive it from, so this is the only durable record of the typed hours.
      durationMinutes: Math.round(cmd.durationHours * 60),
      lat: cmd.lat ?? null,
      lng: cmd.lng ?? null,
      status: "pending",
      enrouteAt: null, // a brand-new visit has no "On my way" stamp
      startedAt: null,
      completedAt: null,
      notes: cmd.notes,
      position,
    });
    if (!isOk(visitResult)) return visitResult;

    const updated = job.withVisits([...existing, visitResult.value], this.clock.now());
    if (!isOk(updated)) return updated;

    await this.repo.save(updated.value);
    return ok(updated.value);
  }
}
