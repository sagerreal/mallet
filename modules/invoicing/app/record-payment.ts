import type { OrgId, InvoiceId, Money, Result, AppError, Clock } from "@mallet/shared/types";
import { notFound, conflict, validation, ok, err, isOk } from "@mallet/shared/types";
import type { EventBus, IdGenerator } from "@mallet/shared/ports";
import { Invoice } from "../domain/invoice";
import { Payment, type PaymentMethod } from "../domain/payment";
import type { InvoiceRepository } from "../domain/invoice-repository";
import type { PaymentGateway } from "../domain/payment-gateway";

export interface RecordPaymentCommand {
  readonly orgId: OrgId;
  readonly invoiceId: InvoiceId;
  readonly amount: Money;
  readonly method: PaymentMethod;
  readonly idempotencyKey: string; // dedupes retries
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
    if (invoice.props.status === "void") {
      return err(conflict("cannot record a payment on a void invoice"));
    }
    if (cmd.amount <= 0) return err(validation("payment amount must be positive", "amount"));

    const payment = Payment.create({
      id: this.ids.newId(),
      amount: cmd.amount,
      method: cmd.method,
      idempotencyKey: cmd.idempotencyKey,
      externalId: null,
      receivedAt: this.clock.now(),
    });
    if (!isOk(payment)) return payment;

    // Claim the idempotency key. If it was already used, return the current invoice unchanged.
    const claimed = await this.repo.insertPayment(cmd.orgId, cmd.invoiceId, payment.value);
    if (!claimed) {
      const current = await this.repo.findById(cmd.invoiceId);
      return current ? ok(current) : err(notFound("invoice"));
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

    const updated = invoice.recordPayment(payment.value, this.clock.now());
    if (!isOk(updated)) return updated;
    await this.repo.save(updated.value);

    await this.bus.emit({
      name: "invoice.payment.recorded",
      orgId: cmd.orgId,
      payload: {
        invoiceId: updated.value.props.id,
        amountCents: cmd.amount,
        method: cmd.method,
        dueCents: updated.value.due(),
      },
      occurredAt: this.clock.now(),
    });
    if (updated.value.props.status === "paid") {
      await this.bus.emit({
        name: "invoice.paid",
        orgId: cmd.orgId,
        payload: { invoiceId: updated.value.props.id, leadId: updated.value.props.leadId },
        occurredAt: this.clock.now(),
      });
    }
    return ok(updated.value);
  }
}
