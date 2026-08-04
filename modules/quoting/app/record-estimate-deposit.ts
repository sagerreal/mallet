import type { OrgId, EstimateId, Result, AppError, Clock } from "@mallet/shared/types";
import { notFound, conflict, validation, ok, err } from "@mallet/shared/types";
import type { EventBus } from "@mallet/shared/ports";
import type { Estimate } from "../domain/estimate";
import type { EstimateDepositLedger } from "../domain/estimate-deposit-ledger";

export interface RecordEstimateDepositCommand {
  readonly orgId: OrgId;
  readonly estimateId: EstimateId;
  /** The settled amount, taken from Stripe's `amount_total` — never from session metadata. */
  readonly amountCents: number;
  /**
   * WHICH money this is: the settling Stripe payment_intent id. Required — without an identity a
   * deposit cannot be deduplicated, and money you cannot deduplicate is money you will either
   * count twice or lose.
   */
  readonly paymentRef: string;
}

export interface RecordedEstimateDeposit {
  /**
   * Did THIS call append the ledger row? Drives the one-event-per-payment rule. `false` means a
   * duplicate delivery of the SAME payment_ref — the money is on the estimate, it just wasn't
   * recorded twice. An OK result always means this payment is on the ledger; a payment that could
   * not be recorded is an error, never `{recorded: false}`.
   */
  readonly recorded: boolean;
  /** The deposit total now standing on the estimate, summed from its ledger rows. */
  readonly depositPaidCents: number;
}

/** The narrow read this use-case needs; the full EstimateRepository satisfies it. */
export interface EstimateLoader {
  findById(id: EstimateId): Promise<Estimate | null>;
}

/**
 * Record a deposit a customer actually paid, against the quote they paid it on.
 *
 * IDEMPOTENCY — the whole design, because one deposit is delivered TWICE by design: the Stripe
 * webhook (primary recorder) and the /pay/success reconcile both fire for the same settled
 * Checkout Session, either can be first, and they can overlap.
 *
 * The key is the settling **payment_intent id** — the same identity the invoice card path dedupes
 * on. It is NOT the amount. An earlier version guarded on amount (`dep_paid_cents < incoming`),
 * and amount cannot tell the two dangerous cases apart:
 *
 *   - the same payment arriving twice, and
 *   - two DIFFERENT payments on one quote,
 *
 * which are indistinguishable from a bare integer. The second case is reachable: `resignOnSite`
 * replaces the line set on an already-accepted quote, so depositDue() moves and a second checkout
 * session can exist alongside the first. Under the old amount guard one settle order recorded
 * nothing while telling the customer their deposit was confirmed, and the other overwrote the
 * smaller payment with the larger. Both silently lost real money.
 *
 * With the ledger: two distinct payment_refs are two rows and the total ACCUMULATES; the same
 * payment_ref twice is one row and the second delivery is a no-op. `dep_paid_cents` is DERIVED
 * from those rows (SUM) in the same transaction, never blind-written.
 *
 * A wrong-status estimate is a CONFLICT, not a silent no-op: money arrived for something that
 * cannot hold it, and that has to be visible.
 */
export class RecordEstimateDepositUseCase {
  constructor(
    private readonly repo: EstimateLoader,
    private readonly ledger: EstimateDepositLedger,
    private readonly bus: EventBus,
    private readonly clock: Clock,
  ) {}

  async exec(cmd: RecordEstimateDepositCommand): Promise<Result<RecordedEstimateDeposit, AppError>> {
    if (!Number.isFinite(cmd.amountCents) || cmd.amountCents <= 0) {
      return err(validation("a deposit must be a positive amount", "amountCents"));
    }
    const paymentRef = cmd.paymentRef.trim();
    if (paymentRef.length === 0) {
      return err(validation("a deposit must name the payment that settled it", "paymentRef"));
    }

    const estimate = await this.repo.findById(cmd.estimateId);
    // The repo is already tenant-scoped (RLS on the tx); the org compare is defense-in-depth, and
    // makes a cross-tenant estimate id indistinguishable from a missing one.
    if (!estimate || estimate.props.orgId !== cmd.orgId) return err(notFound("estimate"));

    // Checked here for a precise message. The AUTHORITATIVE check is the same condition inside the
    // ledger's INSERT … SELECT, so a status change racing this read still refuses the write.
    if (estimate.props.status !== "accepted") {
      return err(conflict("a deposit can only be recorded against an approved quote", "status"));
    }

    const now = this.clock.now();
    const result = await this.ledger.append({
      estimateId: cmd.estimateId,
      paymentRef,
      amountCents: cmd.amountCents,
      receivedAt: now,
    });

    if (result.kind === "refused") {
      // The estimate stopped being able to hold a deposit between the read above and the write.
      return err(conflict("a deposit can only be recorded against an approved quote", "status"));
    }

    if (result.kind === "duplicate") {
      // The other delivery of this SAME payment won. The money is recorded; don't record or
      // announce it twice.
      return ok({ recorded: false, depositPaidCents: result.depositPaidCents });
    }

    // Only the appender emits — one payment, one event. Audit-only (no registered outbox handler),
    // same as estimate.accepted, whose payload shape this mirrors. depositDue() is the derived ASK
    // and does not move with what was paid, so the event carries all three numbers: what was asked
    // for, what this payment was, and what the quote now holds in total.
    await this.bus.emit({
      name: "estimate.deposit.paid",
      orgId: estimate.props.orgId,
      payload: {
        estimateId: estimate.props.id,
        leadId: estimate.props.leadId,
        amountCents: cmd.amountCents,
        depositPaidCents: result.depositPaidCents,
        depositDueCents: estimate.depositDue(),
        paymentRef,
      },
      occurredAt: now,
    });

    return ok({ recorded: true, depositPaidCents: result.depositPaidCents });
  }
}
