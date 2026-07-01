import type { JobId, Result, AppError, Clock } from "@mallet/shared/types";
import { notFound, ok, err, isOk } from "@mallet/shared/types";
import type { EventBus } from "@mallet/shared/ports";
import type { Job } from "../domain/job";
import type { JobRepository } from "../domain/job-repository";

export interface CompleteJobCommand {
  readonly jobId: JobId;
}

// Marks work done. Emits job.completed — a future handler will ensure an invoice (Phase 2);
// nothing cross-aggregate happens in this pilot transaction.
export class CompleteJobUseCase {
  constructor(
    private readonly repo: JobRepository,
    private readonly bus: EventBus,
    private readonly clock: Clock,
  ) {}

  async exec(cmd: CompleteJobCommand): Promise<Result<Job, AppError>> {
    const job = await this.repo.findById(cmd.jobId);
    if (!job) return err(notFound("job"));
    const done = job.complete(this.clock.now());
    if (!isOk(done)) return done;

    await this.repo.save(done.value);
    await this.bus.emit({
      name: "job.completed",
      orgId: done.value.props.orgId,
      payload: { jobId: done.value.props.id, leadId: done.value.props.leadId },
      occurredAt: this.clock.now(),
    });
    return ok(done.value);
  }
}
