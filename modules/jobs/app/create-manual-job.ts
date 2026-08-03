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
  // A job-specific service address and contact, when they differ from the customer's on file.
  // These were accepted here and DROPPED for want of columns until they got them.
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
  // Required certs resolved from the booking playbook service at voice-booking time (set by
  // the AI front desk's book_visit tool). null / undefined → no requirement; office-created
  // jobs always leave this null.
  readonly requiredCerts?: readonly string[] | null;
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

/**
 * The retired magic value, normalised at the boundary.
 *
 * Before 0133, "this is an estimate visit" travelled as svc='estimate'. A stale browser bundle
 * (SPAs outlive deploys; shops keep tabs open for days) still sends that shape — accepted
 * verbatim it would land as kind='work', svc='estimate': readable as an estimate by the client's
 * legacy fallback, invisible to every kind-based server predicate, and unrepairable by the Type
 * toggle. Normalising here turns the stale write into the correct row instead.
 */
const normalizeSvcKind = (
  svc: string | null | undefined,
  kind: JobKind | undefined,
): { svc: string | null; kind: JobKind | undefined } =>
  svc?.trim().toLowerCase() === "estimate"
    ? { svc: null, kind: kind ?? "estimate" }
    : { svc: svc ?? null, kind };

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
    const norm = normalizeSvcKind(cmd.svc, cmd.kind);
    const job = Job.create({
      id: asJobId(cmd.id ?? this.ids.newId()),
      orgId: cmd.orgId,
      num,
      leadId: cmd.leadId,
      sourceEstimateId: null,
      assigneeUserId: null,
      title: cmd.title,
      svc: norm.svc,
      addr: cmd.addr,
      phone: cmd.phone,
      kind: norm.kind ?? "work",
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
      requiredCerts: cmd.requiredCerts ?? null,
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
