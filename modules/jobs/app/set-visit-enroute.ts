import type { JobId, VisitId, Result, AppError, Clock } from "@mallet/shared/types";
import { notFound, validation, ok, err, isOk } from "@mallet/shared/types";
import { JobVisit } from "../domain/job";
import type { JobRepository } from "../domain/job-repository";
import type { Job } from "../domain/job";

export interface SetVisitEnrouteCommand {
  readonly jobId: JobId;
  readonly visitId: VisitId;
}

// The tech tapped "On my way". This writes a STAMP and nothing else: the visit stays `pending`,
// the job status is untouched, and no event is emitted. Enroute is not a fifth visit status —
// see JobVisitProps.enrouteAt for why.
//
// Only a PENDING visit can be stamped. You cannot be on your way to a visit you are already
// standing on (in_progress), finished (complete) or that was called off (canceled) — accepting
// those would put a travel-start time on a trip that never happened, and travel time is about to
// become payroll input.
const STAMPABLE_STATUS = "pending";

export class SetVisitEnrouteUseCase {
  constructor(
    private readonly repo: JobRepository,
    private readonly clock: Clock,
  ) {}

  async exec(cmd: SetVisitEnrouteCommand): Promise<Result<Job, AppError>> {
    const job = await this.repo.findById(cmd.jobId);
    if (!job) return err(notFound("job"));

    const existing = job.props.visits;
    const idx = existing.findIndex((v) => v.props.id === cmd.visitId);
    if (idx === -1) return err(notFound("visit"));

    const visit = existing[idx];
    if (!visit) return err(notFound("visit"));

    if (visit.props.status !== STAMPABLE_STATUS) {
      return err(
        validation(
          `cannot mark a "${visit.props.status}" visit on my way`,
          "status",
        ),
      );
    }

    // Idempotent, and deliberately NOT a re-stamp: the FIRST tap is the true departure time.
    // A second tap (double-tapped button, replayed request) must not push it later, or the
    // travel segment it bounds silently shrinks.
    if (visit.props.enrouteAt !== null) return ok(job);

    const now = this.clock.now();
    const updated = JobVisit.create({ ...visit.props, enrouteAt: now });
    if (!isOk(updated)) return updated;

    const newVisits = existing.map((v, i) => (i === idx ? updated.value : v));
    const jobResult = job.withVisits(newVisits, now);
    if (!isOk(jobResult)) return jobResult;

    await this.repo.save(jobResult.value);
    return ok(jobResult.value);
  }
}
