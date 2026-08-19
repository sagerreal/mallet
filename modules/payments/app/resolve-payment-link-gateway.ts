import type { TenantTx } from "@mallet/shared/db/tx";
import { asOrgId } from "@mallet/shared/types";
import { loadConfig } from "@mallet/shared/config";
import { createSecretBox } from "@mallet/platform/crypto/secret-box";
import { logger } from "@mallet/shared/observability";
import type { PaymentLinkGateway } from "@mallet/invoicing";
import { DrizzleSettingsRepository } from "@mallet/settings";
import { DrizzleSquareConnectionRepository } from "../infra/drizzle-square-connection-repository";
import { SquarePaymentLinkGateway } from "../infra/square-payment-link-gateway";

/**
 * WHICH PROCESSOR THIS ORG'S INVOICE GOES THROUGH.
 *
 * The gateway used to be chosen ONCE at boot from env vars, which is correct while there is one
 * processor and wrong the moment there are two: a shop on Square would have had its invoices
 * silently minted as Stripe checkout links, which is exactly the bug this resolves. The choice is
 * a per-ORG fact (org_settings.payment_provider), so it has to be made per request.
 *
 * FALLS BACK TO STRIPE, deliberately. An org set to square but with no live connection — they
 * disconnected, or the row was never written — must not have its invoicing break. Stripe is what
 * every org already has, so falling back keeps money moving and the Settings card is where the
 * missing connection is visible.
 */
export const resolvePaymentLinkGateway = async (
  tx: TenantTx,
  orgId: string,
  stripeGateway: PaymentLinkGateway | null,
): Promise<PaymentLinkGateway | null> => {
  const settings = await new DrizzleSettingsRepository(tx, asOrgId(orgId)).getConfig(asOrgId(orgId), () => ({
    services: [],
    notServices: "",
    serviceFee: 89,
    feeCredited: true,
  }));
  if (settings.props.paymentProvider !== "square") return stripeGateway;

  const config = loadConfig();
  const secret = config.SQUARE_TOKEN_ENCRYPTION_KEY;
  if (!secret) {
    logger.warn({ orgId }, "square.link.no_encryption_key");
    return stripeGateway;
  }

  const live = await new DrizzleSquareConnectionRepository(tx, orgId).findLive();
  if (!live) {
    // Set to square, never connected. Say so in the log — silently billing through Stripe when a
    // shop believes they are on Square is the kind of thing nobody notices until reconciliation.
    logger.warn({ orgId }, "square.link.no_connection");
    return stripeGateway;
  }

  const box = createSecretBox(secret);
  if (!box.ok) return stripeGateway;
  const token = box.value.open(live.accessTokenSealed);
  if (!token.ok) {
    logger.error({ orgId }, "square.link.token_unsealable");
    return stripeGateway;
  }

  if (!live.locationId) {
    // Square scopes every payment to a location. Without one there is nothing to charge against.
    logger.warn({ orgId }, "square.link.no_location");
    return stripeGateway;
  }

  return new SquarePaymentLinkGateway({
    environment: config.SQUARE_ENVIRONMENT,
    accessToken: token.value,
    locationId: live.locationId,
    redirectUrl: `${config.PUBLIC_APP_URL ?? ""}/pay/done`,
  });
};
