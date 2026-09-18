import type { OrgId, InvoiceId, Result, ExternalServiceError } from "@mallet/shared/types";

export interface CreatePaymentSessionCmd {
  readonly orgId: OrgId;
  readonly invoiceId: InvoiceId;
  readonly amountCents: number; // balance due
  readonly currency: string; // "usd"
  readonly idempotencyKey: string;
  readonly description: string;
  // Connect destination charge (PR2). Required: card payments route to the shop's connected
  // account, so the use-case supplies both on every call.
  /** The shop's Stripe connected account (acct_...) — the destination the charge settles to. */
  readonly connectedAccountId: string;
  /** Mallet's platform fee in integer cents (application_fee_amount on the destination charge). */
  readonly applicationFeeCents: number;
}

export interface HostedPayment {
  readonly url: string; // Stripe-hosted checkout URL to hand the customer
  readonly externalRef: string; // cs_... session id
}

// Creates a Stripe-hosted payment for an invoice balance and returns a URL. SEPARATE from
// PaymentGateway (which settles a MANUAL payment synchronously) — a card payment settles
// asynchronously via webhook, so this port only produces the hosted link. Injected; the pilot
// binding is StripePaymentLinkGateway (null when Stripe is unconfigured).
export interface PaymentLinkGateway {
  createPaymentSession(
    cmd: CreatePaymentSessionCmd,
  ): Promise<Result<HostedPayment, ExternalServiceError>>;
}
