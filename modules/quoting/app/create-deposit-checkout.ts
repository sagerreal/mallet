import type { OrgId, EstimateId, Result, AppError } from "@mallet/shared/types";
import { notFound, conflict, validation, ok, err, isOk } from "@mallet/shared/types";
import { platformFeeCents } from "@mallet/platform/payments/platform-fee";
import type { DepositLinkGateway } from "../domain/deposit-link-gateway";
import type { ConnectTargetReader } from "../domain/connect-target-reader";
import type { EstimateLoader } from "./record-estimate-deposit";

// Stripe's minimum USD Checkout charge. Below it Stripe returns a deterministic 400, so guard here
// rather than send a request that can only fail (a deterministic failure also counts toward the
// shared circuit breaker). Same constant and same reasoning as CreatePaymentUseCase.
const STRIPE_MIN_CHARGE_CENTS = 50;

export interface CreateDepositCheckoutCommand {
  readonly orgId: OrgId;
  readonly estimateId: EstimateId;
  /** The public quote token — the cancel URL returns the customer to the quote they came from. */
  readonly returnToken: string;
}

export interface CreatedDepositCheckout {
  readonly url: string;
}

/**
 * Mint a Stripe-hosted checkout for the deposit still owed on an ACCEPTED quote.
 *
 * Every message this returns is read by an unauthenticated customer holding a quote link, so the
 * copy names what THEY can do — never the shop's setup screens, the payment provider, or an
 * internal id. (Contrast CreatePaymentUseCase, whose rejections are read by the office and do name
 * "Settings → Payments".)
 *
 * Touches no state: money is recorded only when it settles, by RecordEstimateDepositUseCase.
 */
export class CreateDepositCheckoutUseCase {
  constructor(
    private readonly repo: EstimateLoader,
    private readonly gateway: DepositLinkGateway,
    private readonly connect: ConnectTargetReader,
  ) {}

  async exec(
    cmd: CreateDepositCheckoutCommand,
  ): Promise<Result<CreatedDepositCheckout, AppError>> {
    const estimate = await this.repo.findById(cmd.estimateId);
    if (!estimate || estimate.props.orgId !== cmd.orgId) return err(notFound("estimate"));

    if (estimate.props.status !== "accepted") {
      return err(conflict("Approve this quote first, then you can pay the deposit.", "status"));
    }

    const outstanding = estimate.depositDue() - estimate.props.depPaid;
    if (outstanding <= 0) {
      return err(validation("The deposit on this quote is already paid.", "amount"));
    }
    if (outstanding < STRIPE_MIN_CHARGE_CENTS) {
      return err(
        validation(
          `The deposit ($${(outstanding / 100).toFixed(2)}) is too small to pay by card — contact the business to pay it.`,
          "amount",
        ),
      );
    }

    // A destination charge needs somewhere to settle. Without it the customer would be sent to a
    // checkout that cannot complete, so refuse and tell them the one thing they can do about it.
    const target = await this.connect.read();
    if (!target.connectedAccountId || !target.chargesEnabled) {
      return err(
        conflict(
          "This business can't take card payments online right now — contact them to pay the deposit.",
        ),
      );
    }

    const applicationFeeCents = platformFeeCents(outstanding);
    const session = await this.gateway.createDepositSession({
      orgId: cmd.orgId,
      estimateId: cmd.estimateId,
      amountCents: outstanding,
      currency: "usd",
      // Stable per (org, estimate, amount, destination, fee): a double tap reuses the same Stripe
      // session instead of minting a second one. Includes the destination + fee so a later config
      // change cannot collide with a session created under the old settings.
      idempotencyKey: `dep:${cmd.orgId}:${cmd.estimateId}:${outstanding}:${target.connectedAccountId}:${applicationFeeCents}`,
      description: `Deposit — Quote ${estimate.props.num}`,
      connectedAccountId: target.connectedAccountId,
      applicationFeeCents,
      returnToken: cmd.returnToken,
    });
    if (!isOk(session)) return err(session.error);
    return ok({ url: session.value.url });
  }
}
