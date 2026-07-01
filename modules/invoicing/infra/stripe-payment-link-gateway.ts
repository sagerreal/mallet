import { ok, err, externalService, type Result, type ExternalServiceError } from "@mallet/shared/types";
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
        invoiceId: cmd.invoiceId,
        description: cmd.description,
        idempotencyKey: cmd.idempotencyKey,
        successUrl: `${this.publicAppUrl}/pay/success?invoice=${cmd.invoiceId}`,
        cancelUrl: `${this.publicAppUrl}/pay/cancel?invoice=${cmd.invoiceId}`,
      });
      return ok({ url: result.url, externalRef: result.sessionId });
    } catch (error) {
      return err(externalService("stripe", error instanceof Error ? error.message : "stripe error", true));
    }
  }
}
