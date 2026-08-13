import { ok, err, externalService, type Result, type ExternalServiceError } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import type { StripeClient } from "@mallet/platform/adapters/stripe/stripe-client";
import type {
  TerminalGateway,
  CreateConnectionTokenCmd,
  TerminalConnectionToken,
  CreateTerminalLocationCmd,
  TerminalLocation,
  CreateTapIntentCmd,
  TapPaymentIntent,
  RetrievedTapIntent,
} from "../domain/terminal-gateway";

/**
 * Binds the TerminalGateway port to Stripe (via the StripeClient adapter). Resilience — timeout,
 * idempotent retry, the process-wide breaker — lives in the client; this shapes requests and maps
 * failures to a typed ExternalServiceError, exactly like StripePaymentLinkGateway. Raw provider
 * detail is logged server-side and NEVER returned: the error message here becomes the tRPC
 * BAD_GATEWAY sentence a technician reads at the door.
 */
export class StripeTerminalGateway implements TerminalGateway {
  constructor(private readonly client: StripeClient) {}

  async createConnectionToken(
    cmd: CreateConnectionTokenCmd,
  ): Promise<Result<TerminalConnectionToken, ExternalServiceError>> {
    try {
      const token = await this.client.createTerminalConnectionToken({
        connectedAccountId: cmd.connectedAccountId,
        locationId: cmd.locationId,
      });
      return ok({ secret: token.secret });
    } catch (error) {
      logger.error(
        { err: error instanceof Error ? error.message : String(error), connectedAccountId: cmd.connectedAccountId },
        "stripe.createTerminalConnectionToken failed",
      );
      return err(externalService("stripe", "the payment provider is temporarily unavailable", true));
    }
  }

  async createLocation(
    cmd: CreateTerminalLocationCmd,
  ): Promise<Result<TerminalLocation, ExternalServiceError>> {
    try {
      const location = await this.client.createTerminalLocation({
        connectedAccountId: cmd.connectedAccountId,
        displayName: cmd.displayName,
        addressLine1: cmd.addressLine1,
        idempotencyKey: cmd.idempotencyKey,
      });
      return ok({ locationId: location.locationId });
    } catch (error) {
      logger.error(
        { err: error instanceof Error ? error.message : String(error), connectedAccountId: cmd.connectedAccountId },
        "stripe.createTerminalLocation failed",
      );
      return err(externalService("stripe", "the payment provider is temporarily unavailable", true));
    }
  }

  async createTapPaymentIntent(
    cmd: CreateTapIntentCmd,
  ): Promise<Result<TapPaymentIntent, ExternalServiceError>> {
    try {
      const intent = await this.client.createCardPresentPaymentIntent({
        connectedAccountId: cmd.connectedAccountId,
        amountCents: cmd.amountCents,
        currency: cmd.currency,
        description: cmd.description,
        orgId: cmd.orgId,
        invoiceId: cmd.invoiceId,
        applicationFeeCents: cmd.applicationFeeCents,
        idempotencyKey: cmd.idempotencyKey,
      });
      return ok({ paymentIntentId: intent.paymentIntentId, clientSecret: intent.clientSecret });
    } catch (error) {
      logger.error(
        {
          err: error instanceof Error ? error.message : String(error),
          orgId: cmd.orgId,
          invoiceId: cmd.invoiceId,
        },
        "stripe.createCardPresentPaymentIntent failed",
      );
      return err(externalService("stripe", "the payment provider is temporarily unavailable", true));
    }
  }

  async retrieveTapPaymentIntent(
    connectedAccountId: string,
    paymentIntentId: string,
  ): Promise<Result<RetrievedTapIntent, ExternalServiceError>> {
    try {
      const intent = await this.client.retrieveConnectedPaymentIntent(connectedAccountId, paymentIntentId);
      return ok({
        paymentIntentId: intent.id,
        status: intent.status,
        amountReceivedCents: intent.amount_received ?? 0,
        metadata: intent.metadata ?? {},
      });
    } catch (error) {
      logger.error(
        { err: error instanceof Error ? error.message : String(error), paymentIntentId },
        "stripe.retrieveConnectedPaymentIntent failed",
      );
      return err(externalService("stripe", "the payment provider is temporarily unavailable", true));
    }
  }
}
