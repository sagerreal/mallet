import type { OrgId, LeadId, UserId, Result, AppError, Clock } from "@mallet/shared/types";
import { asJobId, zeroMoney, validation, ok, err, isOk } from "@mallet/shared/types";
import type { EventBus, IdGenerator } from "@mallet/shared/ports";
import { Job } from "../domain/job";
import type { JobRepository } from "../domain/job-repository";

export interface ScheduleJobCommand {
  readonly orgId: OrgId;
  readonly leadId: LeadId;
  readonly title: string | null;
  readonly scheduledStart: Date | null;
  readonly scheduledEnd: Date | null;
  readonly assigneeUserId: UserId | null;
}

// Book a standalone job (not sourced from an estimate) — e.g. a dispatcher scheduling directly.
// total is 0: money on a job lives in Finance/invoicing, not on the work order.
export class ScheduleJobUseCase {
  constructor(
    private readonly repo: JobRepository,
    private readonly bus: EventBus,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async exec(cmd: ScheduleJobCommand): Promise<Result<Job, AppError>> {
    if (
      cmd.scheduledStart !== null &&
      cmd.scheduledEnd !== null &&
      cmd.scheduledEnd < cmd.scheduledStart
    ) {
      return err(validation("scheduled end cannot be before start", "scheduledEnd"));
    }

    const now = this.clock.now();
    const num = await this.repo.nextNumber();
    const job = Job.create({
      id: asJobId(this.ids.newId()),
      orgId: cmd.orgId,
      num,
      leadId: cmd.leadId,
      sourceEstimateId: null,
      assigneeUserId: cmd.assigneeUserId,
      title: cmd.title,
      svc: null,
      status: "scheduled",
      scheduledStart: cmd.scheduledStart,
      scheduledEnd: cmd.scheduledEnd,
      startedAt: null,
      completedAt: null,
      canceledAt: null,
      cancelReason: null,
      total: zeroMoney,
      notes: null,
      checklist: null,
      visits: [],
      createdAt: now,
      updatedAt: now,
    });
    if (!isOk(job)) return job;

    await this.repo.save(job.value);
    await this.bus.emit({
      name: "job.scheduled",
      orgId: cmd.orgId,
      payload: { jobId: job.value.props.id, leadId: cmd.leadId, num },
      occurredAt: now,
    });
    return ok(job.value);
  }
}
