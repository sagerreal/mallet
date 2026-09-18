// Narrow read seam over the quoting module: how much deposit the customer has already paid on
// the estimate a job came from. The invoice credits it, so the bill asks for what is actually
// still owed rather than re-charging money the shop already collected.
export interface EstimateDepositReader {
  /** `estimates.dep_paid_cents` of a live estimate; 0 for a missing or soft-deleted one. */
  depositPaidCents(orgId: string, estimateId: string): Promise<number>;
}
