import type { JobId } from "@mallet/shared/types";
import type { JobStatus } from "./job";

/**
 * modules/jobs/domain/return-trip.ts
 * MAY THIS JOB TAKE ANOTHER TRIP — and if it is finished, may it be reopened to take one?
 *
 * A plumber finishes, then finds out he has to come back: the part is on order, the fitting is
 * wrong, the customer went out before the second half. At that exact moment the sheet offered him
 * "Take payment" and nothing else, because a terminal job refuses a new visit (Job.withVisits).
 *
 * Reopening is already a solved mechanism — Job.reopen + SetVisitStatusUseCase — so the only new
 * question is WHEN reopening is safe, and the answer is about money, not about visits.
 *
 * THE HAZARD, stated plainly. The wrap-up sheet raises the invoice the moment it opens, so by the
 * time anyone is looking at "Take payment" a bill already exists. CreateInvoiceFromJobUseCase is
 * idempotent on `source_job_id`: once that bill exists, re-completing the job returns the SAME row
 * and work added in between never reaches it. So a reopen on a job whose bill has been settled,
 * sent or voided would quietly produce work that can never be billed — or disturb money already
 * taken. This function is the one place that decides, and it is pure so it can be tested without a
 * database and shared by every caller.
 */

/** A job's own bill, as the return-trip rule needs to see it. Integer cents, never dollars. */
export interface JobBillSummary {
  /** The document number, for a refusal that can name the bill it is talking about. */
  readonly num: string;
  readonly status: "draft" | "sent" | "partial" | "paid" | "void";
  /** The denormalized payment ledger sum on this bill. */
  readonly amountPaidCents: number;
}

/** Reads the bill raised FROM a job (`invoices.source_job_id`), or null when there is none. */
export interface JobBillingReader {
  readBillForJob(jobId: JobId): Promise<JobBillSummary | null>;
  /** The same read for a whole page of jobs in ONE query — the field agenda's card slot.
   *  Jobs with no bill are simply absent from the map. */
  readBillsForJobs(jobIds: readonly JobId[]): Promise<Map<JobId, JobBillSummary>>;
}

/**
 * Why a return trip was refused. A tag, not a sentence: the transport owns the wording (see
 * RETURN_TRIP_REFUSAL in field-router.ts) so copy can be reworded without touching the rule.
 */
export type ReturnTripRefusal =
  /** Canceled is fully terminal — Job.reopen only accepts a completed job. */
  | "job_canceled"
  /** The customer has paid, in whole or in part. Money already taken is not ours to disturb. */
  | "money_taken"
  /** The bill is with the customer. Adding work behind a bill they are holding makes it wrong. */
  | "bill_out"
  /** Voided bills keep the job's one invoice slot and cannot be edited — added work is unbillable. */
  | "bill_void";

export type ReturnTripDecision =
  | {
      readonly allowed: true;
      /** Does going ahead require pulling a finished job back into progress first? */
      readonly reopens: boolean;
      /**
       * True when a DRAFT bill already exists and will not pick the new work up.
       *
       * The honest limit of this branch. `findBySourceJob` makes createFromJob idempotent, so the
       * draft raised at the first close-out stays exactly as it was; the added work has to be put
       * on it by hand. Allowed — nothing has been taken and a draft is the office's to edit — but
       * carried out of here so no surface can fail to say so.
       */
      readonly billIsStale: boolean;
    }
  | { readonly allowed: false; readonly refusal: ReturnTripRefusal };

const OPEN: ReturnTripDecision = { allowed: true, reopens: false, billIsStale: false };

/**
 * The whole rule.
 *
 * An OPEN job (scheduled / in_progress) is untouched: adding a visit to it has always been legal
 * and no money is being disturbed, so the bill is not even consulted. The money rule guards the
 * REOPEN and nothing else.
 *
 * A note on deposits, deliberately absent above: a deposit paid on the source ESTIMATE rides onto
 * the bill as a credit (`deposit_paid_cents`) and is NOT a payment against this bill. Deposits are
 * ordinary in the trades, so treating one as "money taken" would block a return trip on most
 * deposit jobs while nothing about the deposit changes on reopen. `amountPaidCents` is the ledger,
 * and the ledger is what settles a bill.
 */
export const decideReturnTrip = (
  jobStatus: JobStatus,
  bill: JobBillSummary | null,
): ReturnTripDecision => {
  if (jobStatus === "canceled") return { allowed: false, refusal: "job_canceled" };
  if (jobStatus !== "complete") return OPEN;

  if (bill === null) return { allowed: true, reopens: true, billIsStale: false };
  // The cents outrank the status column. `status` is denormalized off the ledger and a row
  // carrying a payment must refuse for the money whatever the column happens to say.
  if (bill.amountPaidCents > 0 || bill.status === "paid" || bill.status === "partial") {
    return { allowed: false, refusal: "money_taken" };
  }
  if (bill.status === "void") return { allowed: false, refusal: "bill_void" };
  if (bill.status === "sent") return { allowed: false, refusal: "bill_out" };
  return { allowed: true, reopens: true, billIsStale: true };
};
