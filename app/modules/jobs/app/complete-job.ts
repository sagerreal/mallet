import type { JobId, Result, AppError, Clock } from "@mallet/shared/types";
import { notFound, ok, err, isOk } from "@mallet/shared/types";
import type { EventBus } from "@mallet/shared/ports";
import type { Job } from "../domain/job";
import type { JobRepository } from "../domain/job-repository";

export interface CompleteJobCommand {
  readonly jobId: JobId;
  /**
   * Start a SCHEDULED job first, instead of refusing it.
   *
   * Off by default, because the office's strict rule is deliberate: a dispatcher closing a job
   * nobody has been to is a mistake, not a shortcut (see the note in field-router, which made the
   * same call and fixed its own path locally rather than loosening the domain).
   *
   * The AI assistant is the third caller and needs the other answer. A person typing "mark
   * JOB-1077 complete" has decided the work is done and is telling the system so; there is no
   * Start button they forgot to press, and nothing in this business sits in in_progress at rest,
   * so refusing on that basis refused every job they could name. Verified against the live DB:
   * EVERY open job in the org failed this check.
   *
   * Terminal work is still safe — canStart() is scheduled-only, so a canceled or already-complete
   * job fails both steps and is refused exactly as before.
   */
  readonly startIfScheduled?: boolean;
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

    const autoStarting = cmd.startIfScheduled === true && job.canStart();
    const started = autoStarting ? job.start(this.clock.now()) : ok(job);
    if (!isOk(started)) return started;
    const done = started.value.complete(this.clock.now());
    if (!isOk(done)) return done;

    await this.repo.save(done.value);
    // Emitted only when this call performed the start, so the log does not show a job completing
    // that never began. Nothing subscribes to job.started today; if something ever does, it will
    // see the real transition rather than a gap.
    if (autoStarting) {
      await this.bus.emit({
        name: "job.started",
        orgId: done.value.props.orgId,
        payload: { jobId: done.value.props.id, leadId: done.value.props.leadId },
        occurredAt: this.clock.now(),
      });
    }
    await this.bus.emit({
      name: "job.completed",
      orgId: done.value.props.orgId,
      payload: { jobId: done.value.props.id, leadId: done.value.props.leadId },
      occurredAt: this.clock.now(),
    });
    return ok(done.value);
  }
}
