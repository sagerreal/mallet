import type { JobId, Result, AppError, Clock } from "@mallet/shared/types";
import { notFound, ok, err, isOk } from "@mallet/shared/types";
import type { EventBus } from "@mallet/shared/ports";
import type { Job } from "../domain/job";
import type { JobRepository } from "../domain/job-repository";

export interface StartJobCommand {
  readonly jobId: JobId;
}

export class StartJobUseCase {
  constructor(
    private readonly repo: JobRepository,
    private readonly bus: EventBus,
    private readonly clock: Clock,
  ) {}

  async exec(cmd: StartJobCommand): Promise<Result<Job, AppError>> {
    const job = await this.repo.findById(cmd.jobId);
    if (!job) return err(notFound("job"));
    const started = job.start(this.clock.now());
    if (!isOk(started)) return started;
    // start() is idempotent; skip persist/emit when nothing changed.
    if (started.value === job) return ok(job);

    await this.repo.save(started.value);
    await this.bus.emit({
      name: "job.started",
      orgId: started.value.props.orgId,
      payload: { jobId: started.value.props.id, leadId: started.value.props.leadId },
      occurredAt: this.clock.now(),
    });
    return ok(started.value);
  }
}
