import { describe, it, expect, vi } from "vitest";
import { StripeClient } from "./stripe-client";

// Build a StripeClient whose SDK surface is faked. The constructor needs a key string; we then
// overwrite the private `stripe` field with a fake exposing only what the new methods call. This
// keeps the tests offline while still exercising the param-shaping + result-mapping logic.
function clientWithFakeSdk(fake: unknown): StripeClient {
  const c = new StripeClient("sk_test_dummy");
  (c as unknown as { stripe: unknown }).stripe = fake;
  return c;
}

describe("StripeClient Connect methods", () => {
  it("createExpressAccount creates an express account and returns its id", async () => {
    const create = vi.fn().mockResolvedValue({ id: "acct_123" });
    const c = clientWithFakeSdk({ accounts: { create } });
    const out = await c.createExpressAccount({ country: "US", idempotencyKey: "k1" });
    expect(out).toEqual({ accountId: "acct_123" });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ type: "express", country: "US" }),
      expect.objectContaining({ idempotencyKey: "k1" }),
    );
  });

  it("createAccountLink returns the onboarding url", async () => {
    const create = vi.fn().mockResolvedValue({ url: "https://connect.stripe.com/setup/abc" });
    const c = clientWithFakeSdk({ accountLinks: { create } });
    const out = await c.createAccountLink({
      accountId: "acct_123",
      refreshUrl: "https://app/refresh",
      returnUrl: "https://app/return",
    });
    expect(out).toEqual({ url: "https://connect.stripe.com/setup/abc" });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        account: "acct_123",
        type: "account_onboarding",
        refresh_url: "https://app/refresh",
        return_url: "https://app/return",
      }),
    );
  });

  it("retrieveAccount maps the Stripe Account status flags", async () => {
    const retrieve = vi.fn().mockResolvedValue({
      charges_enabled: true,
      payouts_enabled: false,
      details_submitted: true,
    });
    const c = clientWithFakeSdk({ accounts: { retrieve } });
    const out = await c.retrieveAccount("acct_123");
    expect(out).toEqual({ chargesEnabled: true, payoutsEnabled: false, detailsSubmitted: true });
    expect(retrieve).toHaveBeenCalledWith("acct_123");
  });

  it("createAccountLink throws when Stripe returns no url", async () => {
    const create = vi.fn().mockResolvedValue({ url: null });
    const c = clientWithFakeSdk({ accountLinks: { create } });
    await expect(
      c.createAccountLink({ accountId: "acct_1", refreshUrl: "r", returnUrl: "t" }),
    ).rejects.toThrow();
  });
});
