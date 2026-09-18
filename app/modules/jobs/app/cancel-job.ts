import type { JobId, Result, AppError, Clock } from "@mallet/shared/types";
import { notFound, validation, ok, err, isOk } from "@mallet/shared/types";
import type { EventBus } from "@mallet/shared/ports";
import type { Job } from "../domain/job";
import type { JobRepository } from "../domain/job-repository";

export interface CancelJobCommand {
  readonly jobId: JobId;
  readonly reason: string;
}

export class CancelJobUseCase {
  constructor(
    private readonly repo: JobRepository,
    private readonly bus: EventBus,
    private readonly clock: Clock,
  ) {}

  async exec(cmd: CancelJobCommand): Promise<Result<Job, AppError>> {
    const reason = cmd.reason.trim();
    if (reason.length === 0) return err(validation("a cancel reason is required", "reason"));

    const job = await this.repo.findById(cmd.jobId);
    if (!job) return err(notFound("job"));
    const canceled = job.cancel(reason, this.clock.now());
    if (!isOk(canceled)) return canceled;

    await this.repo.save(canceled.value);
    await this.bus.emit({
      name: "job.canceled",
      orgId: canceled.value.props.orgId,
      payload: { jobId: canceled.value.props.id, leadId: canceled.value.props.leadId, reason },
      occurredAt: this.clock.now(),
    });
    return ok(canceled.value);
  }
}
