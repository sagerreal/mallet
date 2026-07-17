import { describe, it, expect, vi } from "vitest";
import { StripeConnectGateway } from "./stripe-connect-gateway";

// Minimal fake matching only the StripeClient methods the gateway calls.
function fakeStripe(
  over: Partial<Record<"createExpressAccount" | "createAccountLink" | "retrieveAccount", unknown>>,
) {
  return {
    createExpressAccount: over.createExpressAccount ?? vi.fn().mockResolvedValue({ accountId: "acct_1" }),
    createAccountLink: over.createAccountLink ?? vi.fn().mockResolvedValue({ url: "https://x" }),
    retrieveAccount:
      over.retrieveAccount ??
      vi.fn().mockResolvedValue({ chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true }),
  } as never;
}

describe("StripeConnectGateway", () => {
  it("createConnectedAccount returns ok with the account id", async () => {
    const gw = new StripeConnectGateway(fakeStripe({}));
    const r = await gw.createConnectedAccount({ orgId: "org-1" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.accountId).toBe("acct_1");
  });

  it("uses a STABLE per-org idempotency key so concurrent creates collapse to one account", async () => {
    const create = vi.fn().mockResolvedValue({ accountId: "acct_1" });
    const gw = new StripeConnectGateway(fakeStripe({ createExpressAccount: create }));
    await gw.createConnectedAccount({ orgId: "org-42" });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: "connect-acct:org-42" }),
    );
  });

  it("maps a thrown provider error to a generic ExternalServiceError (no leak)", async () => {
    const boom = vi.fn().mockRejectedValue(new Error("stripe: secret key sk_test_abc invalid"));
    const gw = new StripeConnectGateway(fakeStripe({ createExpressAccount: boom }));
    const r = await gw.createConnectedAccount({ orgId: "org-1" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.service).toBe("stripe");
      expect(r.error.message).not.toContain("sk_test_abc"); // no provider internals leaked
    }
  });

  it("createOnboardingLink returns the hosted url", async () => {
    const gw = new StripeConnectGateway(fakeStripe({}));
    const r = await gw.createOnboardingLink({ accountId: "acct_1", refreshUrl: "r", returnUrl: "t" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.url).toBe("https://x");
  });

  it("retrieveStatus maps the status through", async () => {
    const gw = new StripeConnectGateway(fakeStripe({}));
    const r = await gw.retrieveStatus("acct_1");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true });
  });

  it("maps a link failure to ExternalServiceError", async () => {
    const boom = vi.fn().mockRejectedValue(new Error("network"));
    const gw = new StripeConnectGateway(fakeStripe({ createAccountLink: boom }));
    const r = await gw.createOnboardingLink({ accountId: "acct_1", refreshUrl: "r", returnUrl: "t" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.service).toBe("stripe");
  });
});
