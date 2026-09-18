import { ok, err, externalService, type Result, type ExternalServiceError } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import type { StripeClient } from "@mallet/platform/adapters/stripe/stripe-client";
import type {
  DepositLinkGateway,
  CreateDepositSessionCmd,
  HostedDeposit,
} from "../domain/deposit-link-gateway";

// Binds the DepositLinkGateway port to Stripe (via the StripeClient adapter). Shapes the request
// and maps failures to a typed ExternalServiceError; resilience/SDK details live in the client.
// Deliberately the same shape as invoicing's StripePaymentLinkGateway — the only differences are
// the metadata subject (kind:"deposit" + estimateId, so the webhook routes it to the deposit
// recorder) and the return URLs.
export class StripeDepositGateway implements DepositLinkGateway {
  constructor(
    private readonly client: StripeClient,
    private readonly publicAppUrl: string,
  ) {}

  async createDepositSession(
    cmd: CreateDepositSessionCmd,
  ): Promise<Result<HostedDeposit, ExternalServiceError>> {
    try {
      const result = await this.client.createCheckoutSession({
        amountCents: cmd.amountCents,
        currency: cmd.currency,
        orgId: cmd.orgId,
        subject: { kind: "deposit", estimateId: cmd.estimateId },
        description: cmd.description,
        idempotencyKey: cmd.idempotencyKey,
        // {CHECKOUT_SESSION_ID} is a literal placeholder Stripe substitutes at redirect time — it
        // lets the success page reconcile the session immediately instead of waiting on the webhook.
        successUrl: `${this.publicAppUrl}/pay/success?deposit=${cmd.estimateId}&session_id={CHECKOUT_SESSION_ID}`,
        // Back to the quote, not to a generic /pay/cancel: at deposit time there is no invoice, so
        // the quote link is the only page the customer has.
        cancelUrl: `${this.publicAppUrl}/q/${cmd.returnToken}`,
        connectedAccountId: cmd.connectedAccountId,
        applicationFeeCents: cmd.applicationFeeCents,
      });
      return ok({ url: result.url, externalRef: result.sessionId });
    } catch (error) {
      // Log the raw provider detail server-side, return a generic message: this becomes the
      // customer-facing error on an unauthenticated page, and Stripe internals (masked-key auth
      // errors, request ids, "circuit breaker is open") must never reach it.
      logger.error(
        {
          err: error instanceof Error ? error.message : String(error),
          orgId: cmd.orgId,
          estimateId: cmd.estimateId,
        },
        "stripe.createCheckoutSession (deposit) failed",
      );
      return err(externalService("stripe", "the payment provider is temporarily unavailable", true));
    }
  }
}
