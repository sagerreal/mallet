import type { JobId, Result, AppError, Clock } from "@mallet/shared/types";
import { asVisitId, notFound, conflict, ok, err, isOk } from "@mallet/shared/types";
import type { IdGenerator } from "@mallet/shared/ports";
import { JobVisit, type Job } from "../domain/job";
import type { JobRepository } from "../domain/job-repository";
import {
  decideReturnTrip,
  type JobBillingReader,
  type ReturnTripRefusal,
} from "../domain/return-trip";
import { nextVisitPosition } from "./create-visit";

export interface AddReturnTripCommand {
  readonly jobId: JobId;
  /** Why he has to come back. Required — see the field router's input for why it is the row. */
  readonly reason: string;
  readonly durationHours: number;
}

export interface ReturnTripAdded {
  readonly job: Job;
  /** True when this booking pulled a finished job back into progress. */
  readonly reopened: boolean;
  /** True when a draft bill already exists and will not pick the new work up. */
  readonly billIsStale: boolean;
}

/**
 * What the caller is told, and it names the next step rather than the rule that was broken. The
 * tag rides along as the AppError's `field` so a client can branch on ONE refusal without
 * pattern-matching a sentence written for humans.
 */
const REFUSAL_MESSAGE: Record<ReturnTripRefusal, string> = {
  job_canceled: "This job was canceled — ask the office to set up the return trip.",
  money_taken: "Payment has already been taken on this job — ask the office to book the return trip.",
  bill_out: "The bill for this job has already gone to the customer — ask the office to book the return trip.",
  bill_void: "This job's bill was voided — ask the office to book the return trip.",
};

/**
 * "Need to come back" — booking the return trip, including from a job that is already finished.
 *
 * A technician finishes, then finds out he has to come back. Until now the sheet answered that
 * with "Take payment" and nothing else: `Job.withVisits` refuses a terminal job, so the visit
 * simply could not be created. Reopening is not a new mechanism — `Job.reopen` exists and
 * SetVisitStatusUseCase already reopens a finished job to move a visit on it — the only new thing
 * is deciding when reopening is safe, and `decideReturnTrip` owns that.
 *
 * ONE SAVE, AND THAT IS THE ROLLBACK STORY. The reopen and the appended visit are two changes to
 * the same aggregate, applied in memory and persisted together, so there is no instant at which
 * the job is reopened without its return trip. If building or writing the visit fails, nothing has
 * been written and the job is still finished — there is no "after the reopen" to roll back from.
 * (The request transaction would roll it back anyway; this makes the guarantee local.)
 *
 * The visit lands UNPLACED — no date, no start, nobody on it — because that is the design: he
 * records that a return is needed and why, and the office picks the slot. See the field router.
 */
export class AddReturnTripUseCase {
  constructor(
    private readonly repo: JobRepository,
    private readonly billing: JobBillingReader,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async exec(cmd: AddReturnTripCommand): Promise<Result<ReturnTripAdded, AppError>> {
    const job = await this.repo.findById(cmd.jobId);
    if (!job) return err(notFound("job"));

    // Read inside the caller's transaction, immediately before the write it guards — a payment
    // landing between this read and the save is the case the transaction itself covers.
    const bill = await this.billing.readBillForJob(cmd.jobId);
    const decision = decideReturnTrip(job.props.status, bill);
    if (!decision.allowed) {
      return err(conflict(REFUSAL_MESSAGE[decision.refusal], decision.refusal));
    }

    const now = this.clock.now();
    const existing = job.props.visits;
    const visit = JobVisit.create({
      id: asVisitId(this.ids.newId()),
      assigneeUserId: null,
      scheduledDate: null,
      scheduledStart: null,
      scheduledEnd: null,
      // The only durable record of length on a row with no start/end window.
      durationMinutes: Math.round(cmd.durationHours * 60),
      lat: null,
      lng: null,
      status: "pending",
      enrouteAt: null,
      startedAt: null,
      completedAt: null,
      notes: cmd.reason,
      position: nextVisitPosition(existing),
    });
    if (!isOk(visit)) return visit;

    // Reopened in MEMORY. Nothing reaches the database until the single save below.
    let current = job;
    if (decision.reopens) {
      const reopened = current.reopen(now);
      if (!isOk(reopened)) return reopened;
      current = reopened.value;
    }

    const updated = current.withVisits([...existing, visit.value], now);
    if (!isOk(updated)) return updated;

    await this.repo.save(updated.value);
    return ok({
      job: updated.value,
      reopened: decision.reopens,
      billIsStale: decision.billIsStale,
    });
  }
}
