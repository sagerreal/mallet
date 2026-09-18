import type { JobId, Result, AppError, Clock } from "@mallet/shared/types";
import { notFound, ok, err, isOk } from "@mallet/shared/types";
import type { EventBus } from "@mallet/shared/ports";
import type { Job } from "../domain/job";
import type { JobRepository } from "../domain/job-repository";

export interface RescheduleJobCommand {
  readonly jobId: JobId;
  readonly scheduledStart: Date;
  readonly scheduledEnd: Date;
}

export class RescheduleJobUseCase {
  constructor(
    private readonly repo: JobRepository,
    private readonly bus: EventBus,
    private readonly clock: Clock,
  ) {}

  async exec(cmd: RescheduleJobCommand): Promise<Result<Job, AppError>> {
    const job = await this.repo.findById(cmd.jobId);
    if (!job) return err(notFound("job"));
    const rescheduled = job.schedule(cmd.scheduledStart, cmd.scheduledEnd, this.clock.now());
    if (!isOk(rescheduled)) return rescheduled;

    await this.repo.save(rescheduled.value);
    await this.bus.emit({
      name: "job.rescheduled",
      orgId: rescheduled.value.props.orgId,
      payload: { jobId: rescheduled.value.props.id },
      occurredAt: this.clock.now(),
    });
    return ok(rescheduled.value);
  }
}
