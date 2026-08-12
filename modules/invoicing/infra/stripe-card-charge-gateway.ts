import { ok, err, conflict, externalService, type Result, type AppError } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import { stripeCardDeclineMessage, type StripeClient } from "@mallet/platform/adapters/stripe/stripe-client";
import type { CardChargeGateway, ChargeSavedCardCmd, ChargedCard } from "../domain/card-charge-gateway";

/**
 * Binds the CardChargeGateway port to Stripe (via the StripeClient adapter). Two failure shapes,
 * kept strictly apart:
 *
 *   • a DECLINE (StripeCardError — declined, insufficient funds, expired, 3DS required) maps to
 *     `conflict` carrying Stripe's own customer-facing sentence VERBATIM, because the person at
 *     the door has to read it out and choose another method. Deterministic — the resilience
 *     wrapper already refuses to retry it or count it toward the shared breaker.
 *   • everything else maps to `external_service` with the same generic copy the Checkout gateway
 *     uses; the raw provider detail is logged server-side and never crosses to a device.
 */
export class StripeCardChargeGateway implements CardChargeGateway {
  constructor(private readonly client: StripeClient) {}

  async chargeSavedCard(cmd: ChargeSavedCardCmd): Promise<Result<ChargedCard, AppError>> {
    try {
      const charged = await this.client.chargeSavedCard({
        amountCents: cmd.amountCents,
        currency: cmd.currency,
        customerId: cmd.customerId,
        paymentMethodId: cmd.paymentMethodId,
        description: cmd.description,
        orgId: cmd.orgId,
        invoiceId: cmd.invoiceId,
        connectedAccountId: cmd.connectedAccountId,
        applicationFeeCents: cmd.applicationFeeCents,
        idempotencyKey: cmd.idempotencyKey,
      });
      return ok(charged);
    } catch (error) {
      const declined = stripeCardDeclineMessage(error);
      if (declined) {
        logger.info(
          { orgId: cmd.orgId, invoiceId: cmd.invoiceId, declined },
          "stripe.chargeSavedCard declined",
        );
        return err(conflict(declined));
      }
      logger.error(
        { err: error instanceof Error ? error.message : String(error), orgId: cmd.orgId, invoiceId: cmd.invoiceId },
        "stripe.chargeSavedCard failed",
      );
      return err(externalService("stripe", "the payment provider is temporarily unavailable", true));
    }
  }
}
