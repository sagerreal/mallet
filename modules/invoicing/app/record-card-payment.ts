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

    // Apply atomically. The UPDATE re-asserts the payable status under the row lock, so a void/pay
    // landing between now and the write cannot be clobbered back to 'paid' (a stale in-memory guard
    // could not prevent that — the webhook runs in its own tx, concurrent with the office).
    const { applied, invoice } = await this.repo.applyPayment(cmd.invoiceId, cmd.amountCents);
    if (!invoice) return err(notFound("invoice"));
    if (!applied) {
      // The invoice was paid/void (already, or concurrently between session-create and settlement).
      // The ledger row stands — real money that settled at Stripe — but is NOT applied (no
      // un-voiding, no double-paying). Emit a distinct signal so it surfaces for manual
      // reconciliation / refund instead of sitting silently indistinguishable from an applied row.
      await this.bus.emit({
        name: "invoice.payment.unapplied",
        orgId: cmd.orgId,
        payload: {
          invoiceId: cmd.invoiceId,
          amountCents: cmd.amountCents,
          method: "card",
          paymentIntentId: cmd.paymentIntentId,
          invoiceStatus: invoice.props.status,
        },
        occurredAt: this.clock.now(),
      });
      return ok(invoice);
    }

    await this.bus.emit({
      name: "invoice.payment.recorded",
      orgId: cmd.orgId,
      payload: {
        invoiceId: cmd.invoiceId,
        // See record-payment: the ledger row's id, so two identical part-payments stay distinct.
        paymentId: payment.value.props.id,
        amountCents: cmd.amountCents,
        method: "card",
        dueCents: invoice.due(),
      },
      occurredAt: this.clock.now(),
    });
    if (invoice.props.status === "paid") {
      await this.bus.emit({
        name: "invoice.paid",
        orgId: cmd.orgId,
        payload: { invoiceId: cmd.invoiceId, leadId: invoice.props.leadId },
        occurredAt: this.clock.now(),
      });
    }
    return ok(invoice);
  }
}
