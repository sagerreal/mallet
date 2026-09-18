import type { OrgId, LeadId, JobId, Result, AppError, Money, ValidationError, Clock } from "@mallet/shared/types";
import { asJobId, money, zeroMoney, validation, ok, err, isOk } from "@mallet/shared/types";
import type { EventBus, IdGenerator } from "@mallet/shared/ports";
import { logger } from "@mallet/shared/observability";
import { Job, type JobKind, type CallbackReason } from "../domain/job";
import { JobLine } from "../domain/job-execution";
import type { JobRepository } from "../domain/job-repository";

/** One priced line arriving WITH the create (a booked flat price). Cents are integers. */
export interface CreateManualJobLineInput {
  readonly description: string;
  readonly quantity: number;
  readonly rateCents: number;
  readonly costCents?: number;
  /** Omitted reads as TRUE (JobLine.create's default). */
  readonly taxable?: boolean;
}

// Matches the router's zod bound (createJobInput lines max 200) so a direct server-side caller
// (the voice front desk) hits the same ceiling as the API boundary.
const MAX_LINES = 200;

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
  // Priced lines arriving WITH the create — the sanctioned money-at-create exception: a booked
  // FLAT price the caller was already quoted (voice front desk) or an office create that books
  // a flat-priced service. Absent/empty → today's behavior (total 0, no lines).
  readonly lines?: readonly CreateManualJobLineInput[];
}

// A dispatcher creating a standalone job by hand (no source estimate). Money on the work order
// at create is allowed for exactly ONE case: a booked FLAT price (cmd.lines) — the caller was
// quoted that number, so it persists as job lines and the job total. Everything else keeps
// total 0: estimate visits NEVER carry money at create, and ad-hoc pricing still lives in
// Finance/invoicing (mirrors ScheduleJobUseCase).
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

// Boundary validation for the priced lines, run BEFORE any write, on the NORMALIZED kind. The
// estimate invariant lives here in the DOMAIN — not in caller discipline: an estimate visit
// NEVER carries money at create (the router's zod has no cross-field constraint and book_visit
// only gates by lane, so any future caller could combine the two — this is where that dies).
// JobLine.create re-checks the sign bounds; the integer-cents checks live here because money()
// treats a fractional cent as a programmer error (throw), and a caller-supplied fraction must
// surface as a validation Result instead. Returns null when the command is clean.
const validateLines = (
  kind: JobKind,
  lines: readonly CreateManualJobLineInput[],
): ValidationError | null => {
  if (kind === "estimate" && lines.length > 0) {
    return validation(
      "estimate visits cannot carry priced lines at create — price at the door or quote from the office",
      "lines",
    );
  }
  if (lines.length > MAX_LINES) {
    return validation(`a job accepts at most ${MAX_LINES} lines`, "lines");
  }
  for (const l of lines) {
    if (!Number.isInteger(l.rateCents)) return validation("rate must be integer cents", "rateCents");
    if (l.costCents !== undefined && !Number.isInteger(l.costCents)) {
      return validation("cost must be integer cents", "costCents");
    }
    if (l.quantity < 0) return validation("quantity cannot be negative", "quantity");
    if (l.rateCents < 0) return validation("rate cannot be negative", "rateCents");
    if (l.costCents !== undefined && l.costCents < 0) return validation("cost cannot be negative", "costCents");
  }
  return null;
};

// The priced sum, Σ round(quantity × rateCents) — the same per-line rounding the on-site
// signature snapshot uses (job-signature.ts), so a fractional quantity never drifts the total.
const pricedTotal = (lines: readonly CreateManualJobLineInput[]): Money => {
  const cents = lines.reduce((sum, l) => sum + Math.round(l.quantity * l.rateCents), 0);
  return cents > 0 ? money(cents) : zeroMoney;
};

export class CreateManualJobUseCase {
  constructor(
    private readonly repo: JobRepository,
    private readonly bus: EventBus,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async exec(cmd: CreateManualJobCommand): Promise<Result<Job, AppError>> {
    const lines = cmd.lines ?? [];
    // Normalized BEFORE the line validation: the estimate-money guard must hold for the
    // stale-bundle svc='estimate' shape too, which only reads as an estimate after normalization.
    const norm = normalizeSvcKind(cmd.svc, cmd.kind);
    const linesError = validateLines(norm.kind ?? "work", lines);
    if (linesError) return err(linesError);

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
      total: pricedTotal(lines),
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

    // THE BOOKED PRICE, snapshotted as job lines — built before the insert so a bad line fails
    // the whole create (nothing written), mirroring CreateJobFromEstimateUseCase's line copy.
    const jobLines: JobLine[] = [];
    for (const [i, l] of lines.entries()) {
      const line = JobLine.create({
        id: this.ids.newId(),
        jobId: job.value.props.id,
        description: l.description,
        quantity: l.quantity,
        rateCents: l.rateCents,
        costCents: l.costCents ?? 0,
        taxable: l.taxable,
        position: i + 1,
      });
      if (!isOk(line)) return line;
      jobLines.push(line.value);
    }

    await this.repo.insertManual(job.value);
    // Written after the job row exists, in the same tenant transaction (the repo is tx-bound).
    if (jobLines.length > 0) {
      await this.repo.replaceLines(job.value.props.id, jobLines, now);
    }
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
