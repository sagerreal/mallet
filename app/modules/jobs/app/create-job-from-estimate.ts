import type { OrgId, EstimateId, JobId, Result, AppError, Clock } from "@mallet/shared/types";
import {
  asJobId,
  asVisitId,
  money,
  zeroMoney,
  notFound,
  conflict,
  ok,
  err,
  isOk,
} from "@mallet/shared/types";
import type { EventBus, IdGenerator } from "@mallet/shared/ports";
import { Job, JobVisit, DEFAULT_VISIT_DURATION_MINUTES } from "../domain/job";
import { JobLine } from "../domain/job-execution";
import type { JobRepository } from "../domain/job-repository";
import type { EstimateReader, EstimateSummary } from "../domain/estimate-reader";

export interface CreateJobFromEstimateCommand {
  readonly orgId: OrgId;
  readonly estimateId: EstimateId;
}

// Turn an accepted estimate into a scheduled job. Idempotent: one active job per accepted
// estimate — a repeat call returns the existing job (checked in-app, backstopped by a partial
// unique index for the concurrent-double-call race).
//
// TWO paths. When the estimate points at the scope-visit job it priced (estimate.jobId, set at
// draft time from the pipeline's scoped card), that job CONVERTS into the sold work in place —
// the walkthrough, the quote and the work stay one thread instead of a duplicate job appearing
// at accept. Everything else — no jobId, a vanished job, a job already sold — takes the original
// mint path unchanged.
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

    // Idempotency for BOTH paths: a converted job carries source_estimate_id exactly like a
    // minted one, so a re-accept finds it here and returns without seeding a second visit.
    const existing = await this.repo.findBySourceEstimate(cmd.estimateId);
    if (existing) return ok(existing);

    if (estimate.jobId) {
      const converted = await this.tryConvert(cmd, estimate, estimate.jobId);
      if (converted) return converted;
      // null = the pointed-at job cannot be converted (missing, already work, canceled, or we
      // lost a race) — fall through to the mint path, which never touches that job.
    }

    return this.mint(cmd, estimate);
  }

  /**
   * Convert the scope-visit job the estimate priced into the sold work, in place.
   *
   * Returns null to signal "mint instead" — deliberately not an error: a stale or hand-edited
   * jobId must never fail the accept, it just loses the nicety of conversion.
   */
  private async tryConvert(
    cmd: CreateJobFromEstimateCommand,
    estimate: EstimateSummary,
    rawJobId: string,
  ): Promise<Result<Job, AppError> | null> {
    const jobId = asJobId(rawJobId);
    const target = await this.repo.findById(jobId);
    if (!target) return null; // vanished/archived → mint
    if (target.props.kind !== "estimate") {
      // Already sold work. Same estimate → idempotent return (defense-in-depth; the
      // findBySourceEstimate pre-check answers this first). Anything else is somebody's
      // existing work order — never mangle it, mint a fresh job.
      return target.props.sourceEstimateId === estimate.id ? ok(target) : null;
    }

    const lines = this.buildLines(estimate, jobId);
    if (!isOk(lines)) return lines;

    const now = this.clock.now();
    const adopted = await this.repo.adoptEstimateOnJob(
      cmd.orgId,
      jobId,
      {
        sourceEstimateId: estimate.id,
        totalCents: estimate.totalCents,
        taxBps: estimate.taxBps,
        taxCents: estimate.taxCents,
        title: estimate.title,
      },
      lines.value,
      now,
    );
    if (!adopted) return null; // changed under us (raced/canceled) → mint path decides

    const converted = await this.repo.findById(jobId);
    if (!converted) {
      // The UPDATE succeeded and the row is gone in the same tx — corruption, not a race.
      return err(conflict("the converted job could not be reloaded"));
    }

    // An existing job changing is job.updated — the vocabulary every other job mutation uses.
    // job.created stays reserved for rows that did not exist before.
    await this.bus.emit({
      name: "job.updated",
      orgId: cmd.orgId,
      payload: { jobId: converted.props.id },
      occurredAt: now,
    });
    return ok(converted);
  }

  /** The original path: mint a brand-new work job from the accepted estimate. */
  private async mint(
    cmd: CreateJobFromEstimateCommand,
    estimate: EstimateSummary,
  ): Promise<Result<Job, AppError>> {
    const now = this.clock.now();
    const num = await this.repo.nextNumber();
    const total = estimate.totalCents > 0 ? money(estimate.totalCents) : zeroMoney;
    // Snapshotted with the total, from the same rounding chain that produced it. The total is
    // tax-INCLUSIVE, so this records the split rather than adding anything to what is owed.
    const tax = estimate.taxCents > 0 ? money(estimate.taxCents) : zeroMoney;

    // Seed ONE unplaced default-length visit so the job modal always shows an editable
    // Length row and the schedule tray's "2h" reflects persisted data, not a display fallback.
    const visit = JobVisit.create({
      id: asVisitId(this.ids.newId()),
      assigneeUserId: null,
      scheduledDate: null,
      scheduledStart: null,
      scheduledEnd: null,
      durationMinutes: DEFAULT_VISIT_DURATION_MINUTES,
      status: "pending",
      enrouteAt: null, // a brand-new visit has no "On my way" stamp
      startedAt: null,
      completedAt: null,
      notes: null,
      position: 1,
    });
    if (!isOk(visit)) return visit;

    const job = Job.create({
      id: asJobId(this.ids.newId()),
      orgId: cmd.orgId,
      num,
      leadId: estimate.leadId,
      sourceEstimateId: estimate.id,
      assigneeUserId: null,
      title: estimate.title,
      svc: null,
      kind: "work", // estimate-SOURCED jobs are sold work; 'estimate' kind = pre-quote scope visit
      status: "scheduled",
      scheduledStart: null,
      scheduledEnd: null,
      startedAt: null,
      completedAt: null,
      canceledAt: null,
      cancelReason: null,
      total,
      taxBps: estimate.taxBps,
      tax,
      notes: null,
      checklist: null,
      visits: [visit.value],
      createdAt: now,
      updatedAt: now,
    });
    if (!isOk(job)) return job;

    const lines = this.buildLines(estimate, job.value.props.id);
    if (!isOk(lines)) return lines;

    // Idempotent insert: DO NOTHING on conflict keeps the transaction valid (a raised unique
    // violation would abort it, making any recovery query fail). If we lost the race, re-fetch and
    // return the winner instead of surfacing a conflict.
    const inserted = await this.repo.insertForEstimate(job.value);
    if (!inserted) {
      const raced = await this.repo.findBySourceEstimate(cmd.estimateId);
      if (raced) return ok(raced);
      return err(conflict("a job already exists for this estimate"));
    }

    // Written after the job row exists, in the same transaction. Not part of insertForEstimate's
    // conflict path on purpose: if we lost the race the winner already carries its own lines, and
    // writing ours over them would replace the scope another request just committed.
    //
    // The estimate's total rides along because replaceLines otherwise re-derives one from the
    // lines, and the accepted figure is tax-inclusive and possibly discounted — see the port doc.
    // Passing it keeps the stored total identical to the number the customer said yes to, which is
    // the one this use-case just wrote into the row above.
    if (lines.value.length > 0) {
      await this.repo.replaceLines(job.value.props.id, lines.value, now, estimate.totalCents);
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

  /**
   * THE SOLD SCOPE, copied onto the job. Without it the job carried a title and a total and the
   * technician had to open the quote to find out what the work actually was. A SNAPSHOT, like
   * Jobber's: later edits to the quote do not reach through, because the job is what is being
   * done now and the quote is what was agreed then. Shared by both paths — a converted job
   * carries exactly the scope a minted one would.
   */
  private buildLines(estimate: EstimateSummary, jobId: JobId): Result<JobLine[], AppError> {
    const lines: JobLine[] = [];
    for (const [i, l] of estimate.lines.entries()) {
      const line = JobLine.create({
        id: this.ids.newId(),
        jobId,
        description: l.description,
        quantity: l.quantity,
        rateCents: l.rateCents,
        costCents: l.costCents,
        taxable: l.taxable,
        position: l.position || i + 1,
      });
      if (!isOk(line)) return line;
      lines.push(line.value);
    }
    return ok(lines);
  }
}
