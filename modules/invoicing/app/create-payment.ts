import type { OrgId, InvoiceId, Result, AppError } from "@mallet/shared/types";
import { notFound, conflict, validation, ok, err, isOk } from "@mallet/shared/types";
import type { InvoiceRepository } from "../domain/invoice-repository";
import type { PaymentLinkGateway } from "../domain/payment-link-gateway";

export interface CreatePaymentCommand {
  readonly orgId: OrgId;
  readonly invoiceId: InvoiceId;
}

export interface CreatedPayment {
  readonly url: string;
}

// Create a Stripe-hosted payment for an invoice's balance and return the URL (delivered to the
// customer via SMS/email). Does NOT touch the ledger — money is applied only by the webhook, so
// there's no pending row to reconcile. The idempotency key is stable per (org, invoice, balance)
// so a repeated click reuses the same Stripe session rather than creating a duplicate.
export class CreatePaymentUseCase {
  constructor(
    private readonly repo: InvoiceRepository,
    private readonly gateway: PaymentLinkGateway,
  ) {}

  async exec(cmd: CreatePaymentCommand): Promise<Result<CreatedPayment, AppError>> {
    const invoice = await this.repo.findById(cmd.invoiceId);
    if (!invoice) return err(notFound("invoice"));
    if (invoice.props.status !== "sent" && invoice.props.status !== "partial") {
      return err(conflict(`cannot collect a payment on a ${invoice.props.status} invoice`));
    }
    const dueCents = invoice.due();
    if (dueCents <= 0) return err(validation("invoice has no balance due", "amount"));

    const session = await this.gateway.createPaymentSession({
      orgId: cmd.orgId,
      invoiceId: cmd.invoiceId,
      amountCents: dueCents,
      currency: "usd",
      idempotencyKey: `pl:${cmd.orgId}:${cmd.invoiceId}:${dueCents}`,
      description: `Invoice ${invoice.props.num}`,
    });
    if (!isOk(session)) return err(session.error);
    return ok({ url: session.value.url });
  }
}
