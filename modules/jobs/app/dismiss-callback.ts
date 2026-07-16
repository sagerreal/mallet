import type { Result, AppError, Clock, JobId } from "@mallet/shared/types";
import { notFound, ok, err, isOk } from "@mallet/shared/types";
import type { EventBus } from "@mallet/shared/ports";
import { logger } from "@mallet/shared/observability";
import type { Job } from "../domain/job";
import type { JobRepository } from "../domain/job-repository";

export interface DismissCallbackCommand {
  readonly jobId: JobId;
}

export class DismissCallbackUseCase {
  constructor(
    private readonly repo: JobRepository,
    private readonly bus: EventBus,
    private readonly clock: Clock,
  ) {}

  async exec(cmd: DismissCallbackCommand): Promise<Result<Job, AppError>> {
    const job = await this.repo.findById(cmd.jobId);
    if (!job) return err(notFound("job not found"));

    const now = this.clock.now();
    const dismissed = job.dismissCallback(now);
    if (!isOk(dismissed)) return dismissed;

    await this.repo.save(dismissed.value);
    await this.bus.emit({
      name: "job.updated",
      orgId: dismissed.value.props.orgId,
      payload: { jobId: dismissed.value.props.id },
      occurredAt: now,
    });
    logger.info({ jobId: cmd.jobId, orgId: dismissed.value.props.orgId }, "job.updated");
    return ok(dismissed.value);
  }
}
