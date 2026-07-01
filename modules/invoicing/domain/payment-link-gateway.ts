import type { OrgId, InvoiceId, Result, ExternalServiceError } from "@mallet/shared/types";

export interface CreatePaymentSessionCmd {
  readonly orgId: OrgId;
  readonly invoiceId: InvoiceId;
  readonly amountCents: number; // balance due
  readonly currency: string; // "usd"
  readonly idempotencyKey: string;
  readonly description: string;
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
