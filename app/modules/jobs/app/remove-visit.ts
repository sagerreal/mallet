import type { JobId, VisitId, Result, AppError, Clock } from "@mallet/shared/types";
import { notFound, ok, err, isOk } from "@mallet/shared/types";
import type { JobRepository } from "../domain/job-repository";
import type { Job } from "../domain/job";

export interface RemoveVisitCommand {
  readonly jobId: JobId;
  readonly visitId: VisitId;
}

// Drop a visit from the job's collection. The repo's save() will soft-delete the orphan row
// (same pattern as estimate lines). Not allowed on terminal jobs (withVisits enforces this).
export class RemoveVisitUseCase {
  constructor(
    private readonly repo: JobRepository,
    private readonly clock: Clock,
  ) {}

  async exec(cmd: RemoveVisitCommand): Promise<Result<Job, AppError>> {
    const job = await this.repo.findById(cmd.jobId);
    if (!job) return err(notFound("job"));

    const existing = job.props.visits;
    const idx = existing.findIndex((v) => v.props.id === cmd.visitId);
    if (idx === -1) return err(notFound("visit"));

    const newVisits = existing.filter((v) => v.props.id !== cmd.visitId);
    const jobResult = job.withVisits(newVisits, this.clock.now());
    if (!isOk(jobResult)) return jobResult;

    await this.repo.save(jobResult.value);
    return ok(jobResult.value);
  }
}
