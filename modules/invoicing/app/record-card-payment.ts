import type { OrgId, InvoiceId, Result, AppError, Clock } from "@mallet/shared/types";
import { money, notFound, ok, err, isOk } from "@mallet/shared/types";
import type { EventBus, IdGenerator } from "@mallet/shared/ports";
import { Payment } from "../domain/payment";
import type { Invoice } from "../domain/invoice";
import type { InvoiceRepository } from "../domain/invoice-repository";

export interface RecordCardPaymentCommand {
  readonly orgId: OrgId;
  readonly invoiceId: InvoiceId;
  readonly amountCents: number; // the amount Stripe actually settled
  readonly paymentIntentId: string; // pi_… — the ledger idempotency key + external id
}

// Records a card payment confirmed by a Stripe webhook, reusing the exact idempotent + atomic path
// as manual payments. Keyed on the immutable payment_intent id, so webhook redelivery (or both
// checkout.session.completed AND payment_intent.succeeded) records the money exactly once. No
// gateway call — the money already settled at Stripe.
export class RecordCardPaymentUseCase {
  constructor(
    private readonly repo: InvoiceRepository,
    private readonly bus: EventBus,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async exec(cmd: RecordCardPaymentCommand): Promise<Result<Invoice | null, AppError>> {
    const payment = Payment.create({
      id: this.ids.newId(),
      amount: money(cmd.amountCents),
      method: "card",
      idempotencyKey: cmd.paymentIntentId,
      externalId: cmd.paymentIntentId,
      receivedAt: this.clock.now(),
    });
    if (!isOk(payment)) return payment;

    // Claim the key. Already claimed → this event was already recorded; return the current invoice.
    const claimed = await this.repo.insertPayment(cmd.orgId, cmd.invoiceId, payment.value);
    if (!claimed) return ok(await this.repo.findById(cmd.invoiceId));

    const invoice = await this.repo.findById(cmd.invoiceId);
    if (!invoice) return err(notFound("invoice"));
    // Only apply to a payable invoice. If it was paid/void between session-create and settlement,
    // the ledger row stands (real money) but we don't apply it (avoid un-voiding / double-paying) —
    // it surfaces for manual reconciliation. This mirrors RecordPayment's payable-status guard.
    if (invoice.props.status !== "sent" && invoice.props.status !== "partial") {
      return ok(invoice);
    }

    const updated = await this.repo.applyPayment(cmd.invoiceId, cmd.amountCents);
    if (!updated) return err(notFound("invoice"));
    await this.bus.emit({
      name: "invoice.payment.recorded",
      orgId: cmd.orgId,
      payload: { invoiceId: cmd.invoiceId, amountCents: cmd.amountCents, method: "card", dueCents: updated.due() },
      occurredAt: this.clock.now(),
    });
    if (updated.props.status === "paid") {
      await this.bus.emit({
        name: "invoice.paid",
        orgId: cmd.orgId,
        payload: { invoiceId: cmd.invoiceId, leadId: updated.props.leadId },
        occurredAt: this.clock.now(),
      });
    }
    return ok(updated);
  }
}
