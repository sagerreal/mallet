import Stripe from "stripe";
import { call, CircuitBreaker, TimeoutError } from "@mallet/platform/resilience";

// The ONLY file that imports the Stripe SDK. Wraps the two calls the app needs behind a tiny
// surface so use-cases/tests never touch the SDK directly. The create call goes through the
// resilience wrapper (timeout + idempotent retry + per-service breaker); the Stripe Idempotency-Key
// makes a retry return the SAME session rather than a duplicate charge.

// Only TRANSIENT failures are worth retrying. A deterministic client error (bad request, auth,
// declined card) fails identically on every attempt, so retrying it wastes round-trips AND — because
// the breaker is shared process-wide (one StripeClient in the DI root) — counts N times toward the
// circuit breaker, which could trip card payments for EVERY tenant. So those must throw on the first
// attempt; we retry only timeouts, dropped connections, 5xx (StripeAPIError), and 429 (rate limit).
export const isRetriableStripeError = (error: unknown): boolean =>
  error instanceof TimeoutError ||
  error instanceof Stripe.errors.StripeConnectionError ||
  error instanceof Stripe.errors.StripeAPIError ||
  error instanceof Stripe.errors.StripeRateLimitError;

export interface CreateCheckoutParams {
  readonly amountCents: number;
  readonly currency: string; // "usd"
  readonly orgId: string;
  readonly invoiceId: string;
  readonly description: string;
  readonly idempotencyKey: string;
  readonly successUrl: string;
  readonly cancelUrl: string;
  // Reserved for the Connect migration (destination charges) — unused in the pilot platform charge.
  readonly connectedAccountId?: string;
  readonly applicationFeeCents?: number;
}

export interface CheckoutResult {
  readonly url: string;
  readonly sessionId: string;
}

// ── Connect (Express) — PR1 onboarding. No charge/transfer here. ──────────────
export interface CreateExpressAccountParams {
  readonly country: string; // "US"
  readonly idempotencyKey: string;
}

export interface CreateAccountLinkParams {
  readonly accountId: string;
  readonly refreshUrl: string;
  readonly returnUrl: string;
}

export interface ConnectAccountStatus {
  readonly chargesEnabled: boolean;
  readonly payoutsEnabled: boolean;
  readonly detailsSubmitted: boolean;
}

export class StripeClient {
  private readonly stripe: Stripe;
  private readonly breaker = new CircuitBreaker("stripe", { failureThreshold: 5, resetMs: 30_000 });

  // maxNetworkRetries: 0 — retries are owned by the resilience wrapper so the policy is uniform.
  constructor(secretKey: string) {
    this.stripe = new Stripe(secretKey, { maxNetworkRetries: 0 });
  }

  async createCheckoutSession(params: CreateCheckoutParams): Promise<CheckoutResult> {
    const metadata = { orgId: params.orgId, invoiceId: params.invoiceId };
    const session = await call(
      () =>
        this.stripe.checkout.sessions.create(
          {
            mode: "payment",
            line_items: [
              {
                quantity: 1,
                price_data: {
                  currency: params.currency,
                  unit_amount: params.amountCents,
                  product_data: { name: params.description },
                },
              },
            ],
            metadata,
            payment_intent_data: { metadata },
            success_url: params.successUrl,
            cancel_url: params.cancelUrl,
          },
          // timeout: the SDK aborts ITS OWN socket at the deadline (v22 has no AbortSignal option),
          // so a retry can't overlap a still-open request. idempotencyKey keeps retries money-safe.
          { idempotencyKey: params.idempotencyKey, timeout: 10_000 },
        ),
      { idempotent: true, retries: 2, timeoutMs: 10_000, breaker: this.breaker, shouldRetry: isRetriableStripeError },
    );
    if (!session.url) throw new Error("stripe returned a checkout session without a url");
    return { url: session.url, sessionId: session.id };
  }

  // Create an Express connected account for a shop. Idempotency-keyed so a retry returns the SAME
  // account rather than minting a duplicate. card_payments + transfers requested so the account can
  // later take destination charges (PR2); onboarding collects the rest via the hosted link.
  async createExpressAccount(params: CreateExpressAccountParams): Promise<{ accountId: string }> {
    const account = await call(
      () =>
        this.stripe.accounts.create(
          {
            type: "express",
            country: params.country,
            capabilities: {
              card_payments: { requested: true },
              transfers: { requested: true },
            },
          },
          { idempotencyKey: params.idempotencyKey, timeout: 10_000 },
        ),
      { idempotent: true, retries: 2, timeoutMs: 10_000, breaker: this.breaker, shouldRetry: isRetriableStripeError },
    );
    return { accountId: account.id };
  }

  // Create a single-use, short-lived Stripe-hosted onboarding link. NOT idempotency-keyed: each
  // (re)start of onboarding must mint a FRESH link (a reused/expired link is a dead end).
  async createAccountLink(params: CreateAccountLinkParams): Promise<{ url: string }> {
    const link = await call(
      () =>
        this.stripe.accountLinks.create({
          account: params.accountId,
          refresh_url: params.refreshUrl,
          return_url: params.returnUrl,
          type: "account_onboarding",
        }),
      { idempotent: false, retries: 2, timeoutMs: 10_000, breaker: this.breaker, shouldRetry: isRetriableStripeError },
    );
    if (!link.url) throw new Error("stripe returned an account link without a url");
    return { url: link.url };
  }

  // Read the connected account's onboarding/capability status. GET — safe to retry.
  async retrieveAccount(accountId: string): Promise<ConnectAccountStatus> {
    const account = await call(
      () => this.stripe.accounts.retrieve(accountId),
      { idempotent: true, retries: 2, timeoutMs: 10_000, breaker: this.breaker, shouldRetry: isRetriableStripeError },
    );
    return {
      chargesEnabled: account.charges_enabled ?? false,
      payoutsEnabled: account.payouts_enabled ?? false,
      detailsSubmitted: account.details_submitted ?? false,
    };
  }

  // Verifies the webhook signature against the raw body. Throws on any tampering / bad signature.
  constructEvent(rawBody: string, signature: string, webhookSecret: string): Stripe.Event {
    return this.stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  }
}
