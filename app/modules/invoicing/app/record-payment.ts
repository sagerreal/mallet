import type { OrgId, InvoiceId, Money, Result, AppError, Clock, UserId } from "@mallet/shared/types";
import { notFound, conflict, validation, ok, err, isOk } from "@mallet/shared/types";
import type { EventBus, IdGenerator } from "@mallet/shared/ports";
import type { Invoice } from "../domain/invoice";
import { Payment, type PaymentMethod } from "../domain/payment";
import type { InvoiceRepository } from "../domain/invoice-repository";
import type { PaymentGateway } from "../domain/payment-gateway";

export interface RecordPaymentCommand {
  readonly orgId: OrgId;
  readonly invoiceId: InvoiceId;
  readonly amount: Money;
  readonly method: PaymentMethod;
  readonly idempotencyKey: string; // dedupes retries
  /**
   * WHO took the money. Comes from the authenticated principal at the boundary, exactly like
   * `orgId` — NEVER from client input, or the ledger would record whoever the caller claimed to be.
   * Required (not optional) so a new call site cannot drop attribution by forgetting a field.
   */
  readonly recordedByUserId: UserId | null;
}

// Record a settled payment. Idempotency is enforced at the ledger: we claim the key with an
// ON CONFLICT DO NOTHING insert BEFORE settling, so a retry with the same key never double-applies
// (and never re-charges). A gateway failure returns an error, which the boundary throws — rolling
// back the whole request transaction, including the just-claimed ledger row.
export class RecordPaymentUseCase {
  constructor(
    private readonly repo: InvoiceRepository,
    private readonly gateway: PaymentGateway,
    private readonly bus: EventBus,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async exec(cmd: RecordPaymentCommand): Promise<Result<Invoice, AppError>> {
    const invoice = await this.repo.findById(cmd.invoiceId);
    if (!invoice) return err(notFound("invoice"));
    if (cmd.amount <= 0) return err(validation("payment amount must be positive", "amount"));

    const payment = Payment.create({
      id: this.ids.newId(),
      amount: cmd.amount,
      method: cmd.method,
      idempotencyKey: cmd.idempotencyKey,
      externalId: null,
      recordedByUserId: cmd.recordedByUserId,
      receivedAt: this.clock.now(),
    });
    if (!isOk(payment)) return payment;

    // Claim the idempotency key FIRST. If it was already used, this is a retry — return the current
    // invoice unchanged regardless of its status (a completed payment left it 'paid').
    const claimed = await this.repo.insertPayment(cmd.orgId, cmd.invoiceId, payment.value);
    if (!claimed) {
      const current = await this.repo.findById(cmd.invoiceId);
      return current ? ok(current) : err(notFound("invoice"));
    }

    // A genuinely new payment: money is tracked only after the invoice is sent — a draft has no due
    // date (would be stranded in 'partial'), and a paid/void invoice takes no further payment.
    // Returning err here rolls back the whole request tx, including the payment row just claimed.
    if (invoice.props.status !== "sent" && invoice.props.status !== "partial") {
      return err(conflict(`cannot record a payment on a ${invoice.props.status} invoice`));
    }

    // Settle. Manual = no-op success; the Stripe adapter charges here later.
    const receipt = await this.gateway.recordPayment({
      orgId: cmd.orgId,
      invoiceId: cmd.invoiceId,
      amount: cmd.amount,
      method: cmd.method,
      idempotencyKey: cmd.idempotencyKey,
    });
    if (!isOk(receipt)) return err(receipt.error);

    // Atomic increment (no lost update under concurrency) — NOT an in-memory read-modify-write.
    // The UPDATE re-asserts the payable status under the row lock, so a void/pay committing between
    // the read above and here is caught here rather than silently un-voiding the invoice.
    const { applied, invoice: updated } = await this.repo.applyPayment(cmd.invoiceId, cmd.amount);
    if (!updated) return err(notFound("invoice"));
    if (!applied) {
      // Concurrent void/pay landed. Return an error to roll back the just-claimed ledger row —
      // correct here because a manual settle moved no external money (unlike the card webhook path).
      return err(conflict(`cannot record a payment on a ${updated.props.status} invoice`));
    }

    await this.bus.emit({
      name: "invoice.payment.recorded",
      orgId: cmd.orgId,
      payload: {
        invoiceId: updated.props.id,
        // The ledger row's own id. Without it a consumer cannot tell two identical part-payments
        // apart, and the QuickBooks push would dedupe one of them away as a redelivery.
        paymentId: payment.value.props.id,
        amountCents: cmd.amount,
        method: cmd.method,
        dueCents: updated.due(),
      },
      occurredAt: this.clock.now(),
    });
    if (updated.props.status === "paid") {
      await this.bus.emit({
        name: "invoice.paid",
        orgId: cmd.orgId,
        payload: { invoiceId: updated.props.id, leadId: updated.props.leadId },
        occurredAt: this.clock.now(),
      });
    }
    return ok(updated);
  }
}
