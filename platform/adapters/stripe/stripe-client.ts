import Stripe from "stripe";
import { call, CircuitBreaker } from "@mallet/platform/resilience";

// The ONLY file that imports the Stripe SDK. Wraps the two calls the app needs behind a tiny
// surface so use-cases/tests never touch the SDK directly. The create call goes through the
// resilience wrapper (timeout + idempotent retry + per-service breaker); the Stripe Idempotency-Key
// makes a retry return the SAME session rather than a duplicate charge.

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
          { idempotencyKey: params.idempotencyKey },
        ),
      { idempotent: true, retries: 2, timeoutMs: 10_000, breaker: this.breaker },
    );
    if (!session.url) throw new Error("stripe returned a checkout session without a url");
    return { url: session.url, sessionId: session.id };
  }

  // Verifies the webhook signature against the raw body. Throws on any tampering / bad signature.
  constructEvent(rawBody: string, signature: string, webhookSecret: string): Stripe.Event {
    return this.stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  }
}
