import { ok, err, externalService, type Result, type ExternalServiceError } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import type { StripeClient } from "@mallet/platform/adapters/stripe/stripe-client";
import type { ConnectGateway, ConnectAccountStatus } from "../domain/connect-gateway";

// Binds the ConnectGateway port to Stripe (via StripeClient). Onboarding lifecycle only (PR1).
// Raw provider detail is logged server-side; the port returns a generic ExternalServiceError so
// Stripe internals (masked-key auth errors, request ids, breaker state) never reach office/owner UI.
export class StripeConnectGateway implements ConnectGateway {
  constructor(private readonly client: StripeClient) {}

  async createConnectedAccount(cmd: {
    orgId: string;
  }): Promise<Result<{ accountId: string }, ExternalServiceError>> {
    try {
      // STABLE idempotency key per org (mirrors invoicing's `pl:${orgId}:...` convention): two
      // concurrent creates for the same org — or an immediate retry after a rolled-back save —
      // collapse to the SAME Express account rather than minting duplicates. One account per org.
      const out = await this.client.createExpressAccount({
        country: "US",
        idempotencyKey: `connect-acct:${cmd.orgId}`,
      });
      return ok({ accountId: out.accountId });
    } catch (error) {
      logger.error(
        { err: error instanceof Error ? error.message : String(error), orgId: cmd.orgId },
        "stripe.createExpressAccount failed",
      );
      return err(externalService("stripe", "couldn't reach the payment provider — try again", true));
    }
  }

  async createOnboardingLink(cmd: {
    accountId: string;
    refreshUrl: string;
    returnUrl: string;
  }): Promise<Result<{ url: string }, ExternalServiceError>> {
    try {
      const out = await this.client.createAccountLink(cmd);
      return ok({ url: out.url });
    } catch (error) {
      logger.error(
        { err: error instanceof Error ? error.message : String(error), accountId: cmd.accountId },
        "stripe.createAccountLink failed",
      );
      return err(externalService("stripe", "couldn't reach the payment provider — try again", true));
    }
  }

  async retrieveStatus(accountId: string): Promise<Result<ConnectAccountStatus, ExternalServiceError>> {
    try {
      const status = await this.client.retrieveAccount(accountId);
      return ok(status);
    } catch (error) {
      logger.error(
        { err: error instanceof Error ? error.message : String(error), accountId },
        "stripe.retrieveAccount failed",
      );
      return err(externalService("stripe", "couldn't reach the payment provider — try again", true));
    }
  }
}
