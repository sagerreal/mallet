import type { OrgId, InvoiceId, Result, AppError } from "@mallet/shared/types";
import { notFound, conflict, validation, ok, err, isOk } from "@mallet/shared/types";
import type { InvoiceRepository } from "../domain/invoice-repository";
import type { PaymentLinkGateway } from "../domain/payment-link-gateway";
import type { ConnectTargetReader } from "../domain/connect-target-reader";
import { platformFeeCents } from "@mallet/platform/payments/platform-fee";

// Stripe's minimum charge for a USD Checkout Session. A balance below this is rejected by Stripe
// with a deterministic 400, so we guard it here rather than send a request that can only fail (a
// deterministic failure also counts toward the shared circuit breaker). Sub-minimum remainders are
// collected by another method (cash/check).
const STRIPE_MIN_CHARGE_CENTS = 50;

export interface CreatePaymentCommand {
  readonly orgId: OrgId;
  readonly invoiceId: InvoiceId;
}

export interface CreatedPayment {
  readonly url: string;
  /** The cs_… session id — the minting device polls reconcileCheckout with it. */
  readonly sessionId: string;
}

// Create a Stripe-hosted payment for an invoice's balance and return the URL (delivered to the
// customer via SMS/email). Does NOT touch the ledger — money is applied only by the webhook, so
// there's no pending row to reconcile. The idempotency key is stable per (org, invoice, balance)
// so a repeated click reuses the same Stripe session rather than creating a duplicate.
export class CreatePaymentUseCase {
  constructor(
    private readonly repo: InvoiceRepository,
    private readonly gateway: PaymentLinkGateway,
    private readonly connect: ConnectTargetReader,
  ) {}

  async exec(cmd: CreatePaymentCommand): Promise<Result<CreatedPayment, AppError>> {
    const invoice = await this.repo.findById(cmd.invoiceId);
    if (!invoice) return err(notFound("invoice"));
    if (invoice.props.status !== "sent" && invoice.props.status !== "partial") {
      return err(conflict(`cannot collect a payment on a ${invoice.props.status} invoice`));
    }
    const dueCents = invoice.due();
    if (dueCents <= 0) return err(validation("invoice has no balance due", "amount"));
    if (dueCents < STRIPE_MIN_CHARGE_CENTS) {
      return err(
        validation(
          `the balance due ($${(dueCents / 100).toFixed(2)}) is below the $${(STRIPE_MIN_CHARGE_CENTS / 100).toFixed(2)} card minimum`,
          "amount",
        ),
      );
    }

    // Require Connect: a card payment routes to the shop's connected account as a destination
    // charge, so a shop that hasn't finished Stripe onboarding has nowhere for the money to settle.
    // Fail with a clear, actionable message rather than attempting a charge that cannot succeed.
    const target = await this.connect.read();
    if (!target.connectedAccountId || !target.chargesEnabled) {
      return err(
        conflict(
          "this shop hasn't finished Stripe payment setup — complete onboarding in Settings → Payments to accept cards",
        ),
      );
    }

    const applicationFeeCents = platformFeeCents(dueCents);
    const session = await this.gateway.createPaymentSession({
      orgId: cmd.orgId,
      invoiceId: cmd.invoiceId,
      amountCents: dueCents,
      currency: "usd",
      // Key includes the destination + fee so a later config change can't collide with a prior session.
      idempotencyKey: `pl:${cmd.orgId}:${cmd.invoiceId}:${dueCents}:${target.connectedAccountId}:${applicationFeeCents}`,
      description: `Invoice ${invoice.props.num}`,
      connectedAccountId: target.connectedAccountId,
      applicationFeeCents,
    });
    if (!isOk(session)) return err(session.error);
    // The session id rides back with the url: the device that minted the checkout polls
    // reconcileCheckout with it, so a paid session is recorded even when the customer never
    // completes the success redirect (QR flow: they pay on THEIR phone and close the tab).
    return ok({ url: session.value.url, sessionId: session.value.externalRef });
  }
}
