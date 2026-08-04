import type { OrgId, EstimateId, Result, ExternalServiceError } from "@mallet/shared/types";

export interface CreateDepositSessionCmd {
  readonly orgId: OrgId;
  readonly estimateId: EstimateId;
  /** The deposit still OUTSTANDING — depositDue() minus what has already been collected. */
  readonly amountCents: number;
  readonly currency: string; // "usd"
  readonly idempotencyKey: string;
  readonly description: string;
  /** The shop's Stripe connected account (acct_...) — the destination the charge settles to. */
  readonly connectedAccountId: string;
  /** Mallet's platform fee in integer cents (application_fee_amount on the destination charge). */
  readonly applicationFeeCents: number;
  /**
   * The quote's public token. A canceled checkout must land the customer back on the quote they
   * came from — a generic /pay/cancel page is a dead end for someone who has no invoice yet and
   * no other way back to their link.
   */
  readonly returnToken: string;
}

export interface HostedDeposit {
  readonly url: string; // Stripe-hosted checkout URL to hand the customer
  readonly externalRef: string; // cs_... session id
}

// Creates a Stripe-hosted payment for an accepted quote's DEPOSIT and returns a URL. Mirrors
// invoicing's PaymentLinkGateway exactly (same destination-charge + platform-fee conventions), but
// stays a separate port because the two settle to different places: an invoice payment lands in
// the payments ledger, a deposit lands on estimates.dep_paid_cents. Injected; the pilot binding is
// StripeDepositGateway.
export interface DepositLinkGateway {
  createDepositSession(
    cmd: CreateDepositSessionCmd,
  ): Promise<Result<HostedDeposit, ExternalServiceError>>;
}
