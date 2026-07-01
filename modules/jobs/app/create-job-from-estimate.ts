import type { OrgId, EstimateId, Result, AppError, Clock } from "@mallet/shared/types";
import { asJobId, money, zeroMoney, notFound, conflict, ok, err, isOk } from "@mallet/shared/types";
import type { EventBus, IdGenerator } from "@mallet/shared/ports";
import { Job } from "../domain/job";
import type { JobRepository } from "../domain/job-repository";
import type { EstimateReader } from "../domain/estimate-reader";

export interface CreateJobFromEstimateCommand {
  readonly orgId: OrgId;
  readonly estimateId: EstimateId;
}

// Turn an accepted estimate into a scheduled job. Idempotent: one active job per accepted
// estimate — a repeat call returns the existing job (checked in-app, backstopped by a partial
// unique index for the concurrent-double-call race).
export class CreateJobFromEstimateUseCase {
  constructor(
    private readonly repo: JobRepository,
    private readonly estimates: EstimateReader,
    private readonly bus: EventBus,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async exec(cmd: CreateJobFromEstimateCommand): Promise<Result<Job, AppError>> {
    const estimate = await this.estimates.read(cmd.estimateId);
    if (!estimate) return err(notFound("estimate"));
    if (estimate.status !== "accepted") {
      return err(conflict("estimate must be accepted before a job can be created"));
    }

    const existing = await this.repo.findBySourceEstimate(cmd.estimateId);
    if (existing) return ok(existing); // idempotent

    const now = this.clock.now();
    const num = await this.repo.nextNumber();
    const total = estimate.totalCents > 0 ? money(estimate.totalCents) : zeroMoney;
    const job = Job.create({
      id: asJobId(this.ids.newId()),
      orgId: cmd.orgId,
      num,
      leadId: estimate.leadId,
      sourceEstimateId: estimate.id,
      assigneeUserId: null,
      title: estimate.title,
      status: "scheduled",
      scheduledStart: null,
      scheduledEnd: null,
      startedAt: null,
      completedAt: null,
      canceledAt: null,
      cancelReason: null,
      total,
      notes: null,
      createdAt: now,
      updatedAt: now,
    });
    if (!isOk(job)) return job;

    // Idempotent insert: DO NOTHING on conflict keeps the transaction valid (a raised unique
    // violation would abort it, making any recovery query fail). If we lost the race, re-fetch and
    // return the winner instead of surfacing a conflict.
    const inserted = await this.repo.insertForEstimate(job.value);
    if (!inserted) {
      const raced = await this.repo.findBySourceEstimate(cmd.estimateId);
      if (raced) return ok(raced);
      return err(conflict("a job already exists for this estimate"));
    }

    await this.bus.emit({
      name: "job.created",
      orgId: cmd.orgId,
      payload: {
        jobId: job.value.props.id,
        sourceEstimateId: estimate.id,
        leadId: estimate.leadId,
        num,
      },
      occurredAt: now,
    });
    return ok(job.value);
  }
}
