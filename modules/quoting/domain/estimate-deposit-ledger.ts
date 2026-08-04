import type { EstimateId } from "@mallet/shared/types";

export interface DepositLedgerEntry {
  readonly estimateId: EstimateId;
  /**
   * The identity of the money: the settling Stripe payment_intent id. The SAME value the invoice
   * card path keys its ledger on, extracted from the session identically on both delivery paths
   * (webhook and success-page reconcile) so the two cannot key on different things.
   */
  readonly paymentRef: string;
  readonly amountCents: number;
  readonly receivedAt: Date;
}

/**
 * Outcome of appending one settled deposit.
 *
 * `appended` and `duplicate` are BOTH successes — in either case this payment is on the estimate's
 * ledger. They are told apart only so exactly one of the two deliveries emits the event.
 *
 * `refused` means the precondition failed inside the write (the estimate is gone, archived, or no
 * longer accepted). Nothing was written and nothing should claim it was.
 */
export type DepositLedgerResult =
  | { readonly kind: "appended"; readonly depositPaidCents: number }
  | { readonly kind: "duplicate"; readonly depositPaidCents: number }
  | { readonly kind: "refused" };

/**
 * The append-only record of deposits actually collected on a quote.
 *
 * Replaces the earlier "conditional UPDATE on dep_paid_cents" design, which could not work. That
 * design guarded on the AMOUNT (`dep_paid_cents < $incoming`), and amount cannot distinguish the
 * same payment arriving twice from two genuinely different payments on one quote — so `SET` lost
 * the smaller of two real deposits and `+=` would have double-counted a redelivery. Identity is
 * the only thing that separates them, and `payment_ref` is that identity.
 *
 * The implementation must do both statements in ONE transaction:
 *   1. INSERT the entry ON CONFLICT (org_id, payment_ref) DO NOTHING — rowcount decides the kind,
 *      with the estimate's `accepted` + not-archived state as a precondition of the same statement
 *      (never trusted from an earlier read);
 *   2. on insert, re-derive `estimates.dep_paid_cents` as SUM(amount_cents) over this estimate's
 *      ledger rows. Derived, never blind-written.
 */
export interface EstimateDepositLedger {
  append(entry: DepositLedgerEntry): Promise<DepositLedgerResult>;
}
