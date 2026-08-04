import type { EstimateId } from "@mallet/shared/types";

/**
 * The one write that moves `estimates.dep_paid_cents`.
 *
 * Separate from EstimateRepository.save() on purpose. save() upserts the whole aggregate from an
 * in-memory copy, which is a lost-update waiting to happen here: the SAME deposit arrives twice —
 * once from the Stripe webhook (the primary recorder) and once from the success-page reconcile —
 * and the two can be in flight at the same moment. A read-then-save would let both see depPaid 0
 * and both write, or let a stale copy clobber a concurrent status change.
 *
 * So the contract is a single CONDITIONAL UPDATE whose WHERE clause is the whole guard, exactly
 * like jobs' flipScopeVisitJob: it writes only while the stored value is strictly LESS than the
 * incoming amount (and the row is still an accepted, live estimate), and reports the rowcount.
 * The loser of the race gets `false` and must treat it as "already recorded", not as an error.
 */
export interface EstimateDepositWriter {
  /**
   * @returns true iff THIS call wrote the deposit. false means the guard matched no row — the
   * deposit is already recorded at or above `amountCents`, or the estimate is no longer accepted.
   */
  recordDepositPaid(estimateId: EstimateId, amountCents: number, now: Date): Promise<boolean>;
}
