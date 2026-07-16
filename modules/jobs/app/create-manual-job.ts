import type { OrgId, LeadId, JobId, Result, AppError, Clock } from "@mallet/shared/types";
import { asJobId, zeroMoney, ok, isOk } from "@mallet/shared/types";
import type { EventBus, IdGenerator } from "@mallet/shared/ports";
import { logger } from "@mallet/shared/observability";
import { Job, type JobKind, type CallbackReason } from "../domain/job";
import type { JobRepository } from "../domain/job-repository";

export interface CreateManualJobCommand {
  readonly id?: string; // client-authored id for optimistic UI; minted when absent
  readonly orgId: OrgId;
  readonly leadId: LeadId;
  // 'work' | 'estimate'; omitted by the office modals (defaults to 'work') — the voice
  // front desk passes 'estimate' when booking a pre-quote scope visit.
  readonly kind?: JobKind;
  readonly title: string | null;
  readonly svc: string | null;
  // addr/phone accepted for modal parity but NOT persisted (no job columns) — dropped here.
  readonly addr: string | null;
  readonly phone: string | null;
  readonly notes: string | null;
  // Free-text "anything else noticed?" note from the booking flow (AI front desk). Optional:
  // office-created jobs omit it; the domain normalises empty/whitespace to null.
  readonly scope?: string | null;
  // Callback link: this job is a redo/follow-on of an earlier job (set by the confirm-callback
  // mutation in Phase 1B.3 — office-created jobs leave these null).
  readonly callbackOf?: JobId | null;
  readonly callbackReason?: CallbackReason | null;
}

// A dispatcher creating a standalone job by hand (no source estimate). total is 0:
// money lives in Finance/invoicing, not on the work order (mirrors ScheduleJobUseCase).
//
// VISITS: deliberately NOT seeded here (visits: []) — unlike CreateJobFromEstimateUseCase,
// which seeds a default 2h unplaced visit because no client flow follows the accept.
// Every manual-create client flow authors its visits explicitly right after this
// returns (new-job-modal: one addVisit per hours row; visit-modal and
// new-customer-modal: one default addVisit) — seeding here would DOUBLE them, and
// the store's addJob reconcile keeps the client's optimistic visits, so a
// server-seeded visit would stay invisible until the next hydrate and then appear
// as a duplicate. If a server-side caller with no client flow ever creates manual
// jobs (e.g. an AI tool), seed the default visit THERE.
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
      kind: cmd.kind ?? "work",
      status: "scheduled",
      scheduledStart: null,
      scheduledEnd: null,
      startedAt: null,
      completedAt: null,
      canceledAt: null,
      cancelReason: null,
      total: zeroMoney,
      notes: cmd.notes,
      scope: cmd.scope ?? null,
      callbackOf: cmd.callbackOf ?? null,
      callbackReason: cmd.callbackReason ?? null,
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
