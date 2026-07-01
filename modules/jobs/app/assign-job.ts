import type { JobId, UserId, Result, AppError, Clock } from "@mallet/shared/types";
import { notFound, ok, err, isOk } from "@mallet/shared/types";
import type { EventBus } from "@mallet/shared/ports";
import type { Job } from "../domain/job";
import type { JobRepository } from "../domain/job-repository";

export interface AssignJobCommand {
  readonly jobId: JobId;
  readonly assigneeUserId: UserId | null; // null unassigns
}

export class AssignJobUseCase {
  constructor(
    private readonly repo: JobRepository,
    private readonly bus: EventBus,
    private readonly clock: Clock,
  ) {}

  async exec(cmd: AssignJobCommand): Promise<Result<Job, AppError>> {
    const job = await this.repo.findById(cmd.jobId);
    if (!job) return err(notFound("job"));
    const assigned = job.assignTo(cmd.assigneeUserId, this.clock.now());
    if (!isOk(assigned)) return assigned;

    await this.repo.save(assigned.value);
    await this.bus.emit({
      name: "job.assigned",
      orgId: assigned.value.props.orgId,
      payload: { jobId: assigned.value.props.id, assigneeUserId: cmd.assigneeUserId },
      occurredAt: this.clock.now(),
    });
    return ok(assigned.value);
  }
}
