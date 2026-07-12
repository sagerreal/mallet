import type { JobId, Result, AppError, Clock } from "@mallet/shared/types";
import { notFound, ok, err, isOk } from "@mallet/shared/types";
import type { EventBus } from "@mallet/shared/ports";
import { logger } from "@mallet/shared/observability";
import type { Job, JobChecklistProps } from "../domain/job";
import type { JobRepository } from "../domain/job-repository";

export interface UpdateJobCommand {
  readonly jobId: JobId;
  readonly title?: string | null;
  readonly svc?: string | null;
  readonly notes?: string | null;
  /** undefined = keep; null = detach; object = attach/replace the before-you-leave checklist. */
  readonly checklist?: JobChecklistProps | null;
}

// Edit a job's DB-backed fields (title/svc/notes/checklist). addr/phone are not job columns
// and never reach here. Terminal jobs reject via Job.patchFields (mirrors UpdateCompanyUseCase).
export class UpdateJobUseCase {
  constructor(
    private readonly repo: JobRepository,
    private readonly bus: EventBus,
    private readonly clock: Clock,
  ) {}

  async exec(cmd: UpdateJobCommand): Promise<Result<Job, AppError>> {
    const job = await this.repo.findById(cmd.jobId);
    if (!job) return err(notFound("job not found"));

    const now = this.clock.now();
    const patched = job.patchFields(
      { title: cmd.title, svc: cmd.svc, notes: cmd.notes, checklist: cmd.checklist },
      now,
    );
    if (!isOk(patched)) return patched;

    await this.repo.save(patched.value);
    await this.bus.emit({
      name: "job.updated",
      orgId: patched.value.props.orgId,
      payload: { jobId: patched.value.props.id },
      occurredAt: now,
    });
    logger.info({ jobId: cmd.jobId, orgId: patched.value.props.orgId }, "job.updated");
    return ok(patched.value);
  }
}
