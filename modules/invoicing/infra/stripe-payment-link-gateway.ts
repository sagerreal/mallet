import { ok, err, externalService, type Result, type ExternalServiceError } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import type { StripeClient } from "@mallet/platform/adapters/stripe/stripe-client";
import type {
  PaymentLinkGateway,
  CreatePaymentSessionCmd,
  HostedPayment,
} from "../domain/payment-link-gateway";

// Binds the PaymentLinkGateway port to Stripe (via the StripeClient adapter). Maps the invoice
// balance to a hosted Checkout Session and returns its URL. Resilience/SDK details live in the
// client; this just shapes the request + maps failures to a typed ExternalServiceError.
export class StripePaymentLinkGateway implements PaymentLinkGateway {
  constructor(
    private readonly client: StripeClient,
    private readonly publicAppUrl: string,
  ) {}

  async createPaymentSession(
    cmd: CreatePaymentSessionCmd,
  ): Promise<Result<HostedPayment, ExternalServiceError>> {
    try {
      const result = await this.client.createCheckoutSession({
        amountCents: cmd.amountCents,
        currency: cmd.currency,
        orgId: cmd.orgId,
        subject: { kind: "payment", invoiceId: cmd.invoiceId },
        description: cmd.description,
        idempotencyKey: cmd.idempotencyKey,
        // {CHECKOUT_SESSION_ID} is a literal placeholder Stripe substitutes at redirect time — it
        // lets the success page reconcile the session immediately instead of waiting on the webhook.
        successUrl: `${this.publicAppUrl}/pay/success?invoice=${cmd.invoiceId}&session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${this.publicAppUrl}/pay/cancel?invoice=${cmd.invoiceId}`,
        connectedAccountId: cmd.connectedAccountId,
        applicationFeeCents: cmd.applicationFeeCents,
      });
      return ok({ url: result.url, externalRef: result.sessionId });
    } catch (error) {
      // Log the raw provider detail server-side, but return a generic message: this AppError becomes
      // the client-facing tRPC error (BAD_GATEWAY), and Stripe/resilience internals (masked-key auth
      // errors, request ids, "circuit breaker is open") must not leak to office/owner users.
      logger.error(
        { err: error instanceof Error ? error.message : String(error), orgId: cmd.orgId, invoiceId: cmd.invoiceId },
        "stripe.createCheckoutSession failed",
      );
      return err(externalService("stripe", "the payment provider is temporarily unavailable", true));
    }
  }
}
