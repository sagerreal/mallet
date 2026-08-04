import { withTenant } from "@mallet/shared/db/tx";
import { loadConfig, resolvePublicAppOrigin } from "@mallet/shared/config";
import { OutboxEventBus } from "@mallet/shared/outbox";
import { asEstimateId, asOrgId, systemClock, isOk, type OrgId } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import { getSharedStripeClient } from "@mallet/platform/adapters/stripe/stripe-client";
import { DrizzleEstimateRepository } from "../infra/drizzle-estimate-repository";
import { DrizzlePublicEstimateReader } from "../infra/drizzle-public-estimate-reader";
import { DrizzleConnectTargetReader } from "../infra/drizzle-connect-target-reader";
import { StripeDepositGateway } from "../infra/stripe-deposit-gateway";
import { CreateDepositCheckoutUseCase } from "./create-deposit-checkout";
import { RecordEstimateDepositUseCase } from "./record-estimate-deposit";

// The deposit half of the public quote flow, kept out of public-quote.ts so that file stays about
// accept/decline/change. Same shape as invoicing's public-invoice.ts: the unguessable token (or, on
// the recording side, the org id from a Stripe-verified session) is resolved OUTSIDE the tenant tx,
// then every read/write re-enters withTenant so RLS scopes it.

/**
 * Outcome of a public deposit-checkout attempt, pre-mapped to what an UNAUTHENTICATED caller may
 * learn. `rejected` carries the use-case's own message — unlike the invoice path, those messages
 * are ALREADY customer-facing (see CreateDepositCheckoutUseCase), so flattening them to one
 * generic sentence would throw away the only actionable thing the customer is told.
 */
export type PublicDepositCheckoutOutcome =
  | { kind: "ok"; url: string }
  | { kind: "not_found" }
  | { kind: "rejected"; message: string }
  | { kind: "unavailable" };

const UNCONFIGURED =
  "Card payment isn't available right now — contact the business to pay the deposit.";

/** Mint a Stripe-hosted checkout for the deposit still owed on the quote behind this token. */
export async function createPublicDepositCheckout(
  token: string,
): Promise<PublicDepositCheckoutOutcome> {
  const resolved = await new DrizzlePublicEstimateReader().resolveOrgByToken(token);
  if (!resolved) return { kind: "not_found" };

  const config = loadConfig();
  const origin = resolvePublicAppOrigin(config);
  if (!config.STRIPE_SECRET_KEY || !origin) {
    // Stripe unconfigured on this deployment — the same dark state the invoice path reports.
    return { kind: "rejected", message: UNCONFIGURED };
  }
  // Shared process-wide client: the breaker only works if it sees ALL Stripe traffic.
  const stripe = getSharedStripeClient(config.STRIPE_SECRET_KEY);

  return withTenant(resolved.orgId, async (tx) => {
    const useCase = new CreateDepositCheckoutUseCase(
      new DrizzleEstimateRepository(tx, resolved.orgId),
      new StripeDepositGateway(stripe, origin),
      new DrizzleConnectTargetReader(tx, resolved.orgId),
    );
    const result = await useCase.exec({
      orgId: resolved.orgId,
      estimateId: asEstimateId(resolved.estimateId),
      returnToken: token,
    });
    if (isOk(result)) return { kind: "ok", url: result.value.url };
    switch (result.error.kind) {
      case "not_found":
        return { kind: "not_found" };
      case "external_service":
        return { kind: "unavailable" };
      default:
        return { kind: "rejected", message: result.error.message };
    }
  });
}

/**
 * Record a settled deposit against an estimate. Called by BOTH Stripe entry points (the webhook and
 * the /pay/success reconcile) with the same session amount; the conditional UPDATE inside
 * RecordEstimateDepositUseCase is what makes the second one a no-op.
 *
 * @returns true when the deposit is on the estimate (written now, or already there by the other
 * delivery); false when the estimate cannot hold it. Throws only on a transient infra failure, so
 * the webhook route can answer 500 and let Stripe retry.
 */
export async function recordEstimateDeposit(
  orgId: string,
  estimateId: string,
  amountCents: number,
): Promise<boolean> {
  const tenant: OrgId = asOrgId(orgId);
  return withTenant(tenant, async (tx) => {
    const repo = new DrizzleEstimateRepository(tx, tenant);
    // Emit through the outbox in the SAME tx so estimate.deposit.paid is committed atomically with
    // the deposit write (not an in-memory bus that a rollback would leave lying).
    const bus = new OutboxEventBus(tx, tenant);
    const useCase = new RecordEstimateDepositUseCase(repo, repo, bus, systemClock);
    const result = await useCase.exec({
      orgId: tenant,
      estimateId: asEstimateId(estimateId),
      amountCents,
    });
    if (isOk(result)) return true;
    // not_found / conflict are terminal: retrying will not make the estimate able to hold this
    // money. Log loudly (a real charge has nowhere to land) and let the caller answer 200.
    logger.error(
      { orgId, estimateId, amountCents, err: result.error.message, kind: result.error.kind },
      "deposit could not be recorded on the estimate",
    );
    return false;
  });
}
