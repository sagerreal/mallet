import type { OrgId, EstimateId, Result, AppError, Clock } from "@mallet/shared/types";
import { notFound, conflict, validation, ok, err } from "@mallet/shared/types";
import type { EventBus } from "@mallet/shared/ports";
import type { Estimate } from "../domain/estimate";
import type { EstimateDepositWriter } from "../domain/estimate-deposit-writer";

export interface RecordEstimateDepositCommand {
  readonly orgId: OrgId;
  readonly estimateId: EstimateId;
  /** The settled amount, taken from Stripe's `amount_total` — never from session metadata. */
  readonly amountCents: number;
}

export interface RecordedEstimateDeposit {
  /** Did THIS call write the deposit? false = a concurrent/duplicate delivery already had. */
  readonly recorded: boolean;
  /** What the estimate now holds either way — the caller can report the truth in both cases. */
  readonly depositPaidCents: number;
}

/** The narrow read this use-case needs; the full EstimateRepository satisfies it. */
export interface EstimateLoader {
  findById(id: EstimateId): Promise<Estimate | null>;
}

/**
 * Record a deposit that a customer actually paid, onto the estimate it was paid against.
 *
 * IDEMPOTENCY — this is the whole design, because the same deposit is delivered TWICE by design:
 * the Stripe webhook (primary recorder) and the /pay/success reconcile both call this for the same
 * settled Checkout Session, and either can arrive first.
 *
 * Deposits do NOT write to the `payments` ledger — that table is invoice-scoped (composite FK to
 * invoices) and an accepted quote has no invoice yet — so the payment_intent idempotency key the
 * card path uses has nowhere to live here. The equivalent guarantee comes from the write itself:
 * a single conditional UPDATE that fires only while the stored dep_paid_cents is strictly LESS
 * than the incoming amount (EstimateDepositWriter). Two identical deliveries therefore produce one
 * write and one event; the loser reports recorded:false with the amount that IS on the estimate,
 * which is the truth, not a failure.
 *
 * A wrong-status estimate is a CONFLICT, not a silent no-op: money arrived for something that
 * cannot hold it, and that has to be visible.
 */
export class RecordEstimateDepositUseCase {
  constructor(
    private readonly repo: EstimateLoader,
    private readonly deposits: EstimateDepositWriter,
    private readonly bus: EventBus,
    private readonly clock: Clock,
  ) {}

  async exec(cmd: RecordEstimateDepositCommand): Promise<Result<RecordedEstimateDeposit, AppError>> {
    if (!Number.isFinite(cmd.amountCents) || cmd.amountCents <= 0) {
      return err(validation("a deposit must be a positive amount", "amountCents"));
    }

    const estimate = await this.repo.findById(cmd.estimateId);
    // The repo is already tenant-scoped (RLS on the tx); the org compare is defense-in-depth, and
    // makes a cross-tenant estimate id indistinguishable from a missing one.
    if (!estimate || estimate.props.orgId !== cmd.orgId) return err(notFound("estimate"));

    if (estimate.props.status !== "accepted") {
      return err(
        conflict("a deposit can only be recorded against an approved quote", "status"),
      );
    }

    // Already at or above this amount — the other delivery won. Report it, write nothing, emit
    // nothing. Checked before the UPDATE only to skip a pointless round-trip; the UPDATE's own
    // WHERE is what actually decides the race.
    if (estimate.props.depPaid >= cmd.amountCents) {
      return ok({ recorded: false, depositPaidCents: estimate.props.depPaid });
    }

    const now = this.clock.now();
    const written = await this.deposits.recordDepositPaid(cmd.estimateId, cmd.amountCents, now);
    if (!written) {
      // The concurrent delivery landed between the read above and this UPDATE. Re-read so the
      // answer reflects what is actually stored rather than what we hoped to write.
      const current = await this.repo.findById(cmd.estimateId);
      return ok({ recorded: false, depositPaidCents: current?.props.depPaid ?? estimate.props.depPaid });
    }

    // Only the winner emits — one payment, one event. Audit-only (no registered outbox handler),
    // same as estimate.accepted, whose payload shape this mirrors. depositDue() is the derived ASK
    // (lines → discount → tax → depBps) and does not move with what was paid, so the event carries
    // both numbers: what was asked for, and what actually landed.
    await this.bus.emit({
      name: "estimate.deposit.paid",
      orgId: estimate.props.orgId,
      payload: {
        estimateId: estimate.props.id,
        leadId: estimate.props.leadId,
        amountCents: cmd.amountCents,
        depositDueCents: estimate.depositDue(),
      },
      occurredAt: now,
    });

    return ok({ recorded: true, depositPaidCents: cmd.amountCents });
  }
}
