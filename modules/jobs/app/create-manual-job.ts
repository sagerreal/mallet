import type { OrgId, LeadId, Result, AppError, Clock } from "@mallet/shared/types";
import { asJobId, zeroMoney, ok, isOk } from "@mallet/shared/types";
import type { EventBus, IdGenerator } from "@mallet/shared/ports";
import { logger } from "@mallet/shared/observability";
import { Job } from "../domain/job";
import type { JobRepository } from "../domain/job-repository";

export interface CreateManualJobCommand {
  readonly id?: string; // client-authored id for optimistic UI; minted when absent
  readonly orgId: OrgId;
  readonly leadId: LeadId;
  readonly title: string | null;
  readonly svc: string | null;
  // addr/phone accepted for modal parity but NOT persisted (no job columns) — dropped here.
  readonly addr: string | null;
  readonly phone: string | null;
  readonly notes: string | null;
}

// A dispatcher creating a standalone job by hand (no source estimate). total is 0:
// money lives in Finance/invoicing, not on the work order (mirrors ScheduleJobUseCase).
export class CreateManualJobUseCase {
  constructor(
    private readonly repo: JobRepository,
    private readonly bus: EventBus,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async exec(cmd: CreateManualJobCommand): Promise<Result<Job, AppError>> {
    const now = this.clock.now();
    const num = await this.repo.nextNumber();
    const job = Job.create({
      id: asJobId(cmd.id ?? this.ids.newId()),
      orgId: cmd.orgId,
      num,
      leadId: cmd.leadId,
      sourceEstimateId: null,
      assigneeUserId: null,
      title: cmd.title,
      svc: cmd.svc,
      status: "scheduled",
      scheduledStart: null,
      scheduledEnd: null,
      startedAt: null,
      completedAt: null,
      canceledAt: null,
      cancelReason: null,
      total: zeroMoney,
      notes: cmd.notes,
      checklist: null,
      visits: [],
      createdAt: now,
      updatedAt: now,
    });
    if (!isOk(job)) return job;

    await this.repo.insertManual(job.value);
    await this.bus.emit({
      // A manually-created job is UNSCHEDULED — emit a distinct event so a future
      // job.scheduled handler (which would assume a scheduledStart) never misfires.
      name: "job.created_manual",
      orgId: cmd.orgId,
      payload: { jobId: job.value.props.id, leadId: cmd.leadId, num },
      occurredAt: now,
    });
    logger.info({ jobId: job.value.props.id, orgId: cmd.orgId }, "job.created_manual");
    return ok(job.value);
  }
}
