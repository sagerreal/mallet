import type { Result, AppError, Clock, JobId } from "@mallet/shared/types";
import { notFound, ok, err, isOk } from "@mallet/shared/types";
import type { EventBus } from "@mallet/shared/ports";
import { logger } from "@mallet/shared/observability";
import type { Job, CallbackReason } from "../domain/job";
import type { JobRepository } from "../domain/job-repository";

export interface ConfirmCallbackCommand {
  readonly jobId: JobId;
  readonly originalJobId: JobId;
  readonly reason: CallbackReason;
}

export class ConfirmCallbackUseCase {
  constructor(
    private readonly repo: JobRepository,
    private readonly bus: EventBus,
    private readonly clock: Clock,
  ) {}

  async exec(cmd: ConfirmCallbackCommand): Promise<Result<Job, AppError>> {
    const job = await this.repo.findById(cmd.jobId);
    if (!job) return err(notFound("job not found"));

    const original = await this.repo.findById(cmd.originalJobId);
    if (!original) return err(notFound("original job not found"));

    const now = this.clock.now();
    const marked = job.markCallback(cmd.originalJobId, cmd.reason, now);
    if (!isOk(marked)) return marked;

    await this.repo.save(marked.value);
    await this.bus.emit({
      name: "job.updated",
      orgId: marked.value.props.orgId,
      payload: { jobId: marked.value.props.id },
      occurredAt: now,
    });
    logger.info({ jobId: cmd.jobId, orgId: marked.value.props.orgId }, "job.updated");
    return ok(marked.value);
  }
}
