import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { StripeClient } from "./stripe-client";

// Live TEST-MODE integration — hits Stripe's real test API. Skipped when STRIPE_SECRET_KEY is
// absent (e.g. CI without secrets). Test-mode sessions move no real money.
const hasStripe = Boolean(process.env.STRIPE_SECRET_KEY);
const suite = hasStripe ? describe : describe.skip;

const params = (idempotencyKey: string) => ({
  amountCents: 12_345,
  currency: "usd",
  orgId: "22222222-2222-2222-2222-222222222222",
  subject: { kind: "payment" as const, invoiceId: "11111111-1111-1111-1111-111111111111" },
  description: "Mallet test invoice",
  idempotencyKey,
  successUrl: "https://example.test/pay/success",
  cancelUrl: "https://example.test/pay/cancel",
});

suite("StripeClient against live Stripe test mode", () => {
  it("creates a hosted checkout session and returns a URL + session id", async () => {
    const client = new StripeClient(process.env.STRIPE_SECRET_KEY as string);
    const result = await client.createCheckoutSession(params(`test:${randomUUID()}`));
    expect(result.url).toMatch(/^https:\/\//);
    expect(result.sessionId).toMatch(/^cs_/);
  });

  it("reuses the same session for a repeated idempotency key", async () => {
    const client = new StripeClient(process.env.STRIPE_SECRET_KEY as string);
    const key = `test:${randomUUID()}`;
    const first = await client.createCheckoutSession(params(key));
    const second = await client.createCheckoutSession(params(key));
    expect(second.sessionId).toBe(first.sessionId); // idempotency-key -> same session, no duplicate
  });
});
