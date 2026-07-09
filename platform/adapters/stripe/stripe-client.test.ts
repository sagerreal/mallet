import { describe, it, expect, vi, beforeEach } from "vitest";
import Stripe from "stripe";
import { TimeoutError } from "@mallet/platform/resilience";
import { isRetriableStripeError, StripeClient, type CreateCheckoutParams } from "./stripe-client";

// ---------------------------------------------------------------------------
// isRetriableStripeError — pure function, no mocking needed
// ---------------------------------------------------------------------------

describe("isRetriableStripeError", () => {
  it("returns true for TimeoutError", () => {
    expect(isRetriableStripeError(new TimeoutError(5000))).toBe(true);
  });

  it("returns true for StripeConnectionError", () => {
    expect(isRetriableStripeError(new Stripe.errors.StripeConnectionError({ message: "connection reset" }))).toBe(true);
  });

  it("returns true for StripeAPIError (5xx from Stripe)", () => {
    expect(isRetriableStripeError(new Stripe.errors.StripeAPIError({ message: "internal server error" }))).toBe(true);
  });

  it("returns true for StripeRateLimitError (429)", () => {
    expect(isRetriableStripeError(new Stripe.errors.StripeRateLimitError({ message: "rate limit exceeded" }))).toBe(true);
  });

  it("returns false for StripeCardError (deterministic decline)", () => {
    expect(
      isRetriableStripeError(
        new Stripe.errors.StripeCardError({ message: "card declined", decline_code: "insufficient_funds" }),
      ),
    ).toBe(false);
  });

  it("returns false for StripeInvalidRequestError (bad client data)", () => {
    expect(isRetriableStripeError(new Stripe.errors.StripeInvalidRequestError({ message: "invalid param" }))).toBe(false);
  });

  it("returns false for StripeAuthenticationError", () => {
    expect(isRetriableStripeError(new Stripe.errors.StripeAuthenticationError({ message: "bad api key" }))).toBe(false);
  });

  it("returns false for a plain Error", () => {
    expect(isRetriableStripeError(new Error("something exploded"))).toBe(false);
  });

  it("returns false for a non-error primitive", () => {
    expect(isRetriableStripeError("string error")).toBe(false);
  });

  it("returns false for null", () => {
    expect(isRetriableStripeError(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// StripeClient — inject a fake Stripe SDK instance to avoid any network I/O
//
// Strategy: subclass StripeClient and override the private `stripe` property
// via a cast so the constructor never touches the real Stripe constructor.
// This keeps the resilience wrapper path fully exercised.
// ---------------------------------------------------------------------------

type FakeStripeInstance = {
  checkout: { sessions: { create: ReturnType<typeof vi.fn> } };
  webhooks: { constructEvent: ReturnType<typeof vi.fn> };
};

/** Build a StripeClient that uses a fake Stripe SDK instance. */
function makeClient(): { client: StripeClient; fake: FakeStripeInstance } {
  const fake: FakeStripeInstance = {
    checkout: { sessions: { create: vi.fn() } },
    webhooks: { constructEvent: vi.fn() },
  };
  // StripeClient stores `this.stripe` as a private property. We construct normally
  // (the real Stripe constructor call is cheap — it throws only if key is empty) then
  // immediately overwrite via a cast so no network is ever touched.
  const client = new StripeClient("sk_test_unit_fake_key_for_override");
  // Overwrite the private field via index access — safe in tests; we own the assertion.
  (client as unknown as { stripe: FakeStripeInstance }).stripe = fake;
  return { client, fake };
}

const baseParams: CreateCheckoutParams = {
  amountCents: 9_999,
  currency: "usd",
  orgId: "org-aaa",
  invoiceId: "inv-bbb",
  description: "Roof repair — invoice #42",
  idempotencyKey: "idem-key-001",
  successUrl: "https://example.test/success",
  cancelUrl: "https://example.test/cancel",
};

// ---------------------------------------------------------------------------
// StripeClient.createCheckoutSession
// ---------------------------------------------------------------------------

describe("StripeClient.createCheckoutSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the url and sessionId from the Stripe session on success", async () => {
    const { client, fake } = makeClient();
    fake.checkout.sessions.create.mockResolvedValueOnce({
      url: "https://checkout.stripe.com/pay/cs_test_abc",
      id: "cs_test_abc",
    });

    const result = await client.createCheckoutSession(baseParams);

    expect(result.url).toBe("https://checkout.stripe.com/pay/cs_test_abc");
    expect(result.sessionId).toBe("cs_test_abc");
  });

  it("throws when Stripe returns a session with no url", async () => {
    const { client, fake } = makeClient();
    fake.checkout.sessions.create.mockResolvedValueOnce({ url: null, id: "cs_test_nurl" });

    await expect(client.createCheckoutSession(baseParams)).rejects.toThrow(
      "stripe returned a checkout session without a url",
    );
  });

  it("propagates a StripeCardError without retrying (non-retriable, shouldRetry returns false)", async () => {
    const { client, fake } = makeClient();
    const cardError = new Stripe.errors.StripeCardError({ message: "card declined", decline_code: "insufficient_funds" });
    fake.checkout.sessions.create.mockRejectedValue(cardError);

    await expect(client.createCheckoutSession(baseParams)).rejects.toBeInstanceOf(Stripe.errors.StripeCardError);
    // shouldRetry returns false for card errors, so only one attempt is made
    expect(fake.checkout.sessions.create).toHaveBeenCalledTimes(1);
  });

  it("passes the idempotencyKey and a 10 000 ms timeout to the Stripe SDK call", async () => {
    const { client, fake } = makeClient();
    fake.checkout.sessions.create.mockResolvedValueOnce({
      url: "https://checkout.stripe.com/pay/cs_test_xyz",
      id: "cs_test_xyz",
    });

    await client.createCheckoutSession({ ...baseParams, idempotencyKey: "unique-key-99" });

    const [, requestOptions] = fake.checkout.sessions.create.mock.calls[0] as [
      unknown,
      { idempotencyKey: string; timeout: number },
    ];
    expect(requestOptions.idempotencyKey).toBe("unique-key-99");
    expect(requestOptions.timeout).toBe(10_000);
  });

  it("forwards the correct line_items shape to the Stripe SDK", async () => {
    const { client, fake } = makeClient();
    fake.checkout.sessions.create.mockResolvedValueOnce({
      url: "https://checkout.stripe.com/pay/cs_test_li",
      id: "cs_test_li",
    });

    await client.createCheckoutSession({ ...baseParams, amountCents: 4_200, currency: "usd", description: "Plumbing" });

    const [sessionParams] = fake.checkout.sessions.create.mock.calls[0] as [
      {
        mode: string;
        line_items: Array<{
          quantity: number;
          price_data: { currency: string; unit_amount: number; product_data: { name: string } };
        }>;
      },
      unknown,
    ];
    expect(sessionParams.mode).toBe("payment");
    expect(sessionParams.line_items).toHaveLength(1);
    const lineItem = sessionParams.line_items[0]!;
    expect(lineItem.quantity).toBe(1);
    expect(lineItem.price_data.unit_amount).toBe(4_200);
    expect(lineItem.price_data.currency).toBe("usd");
    expect(lineItem.price_data.product_data.name).toBe("Plumbing");
  });

  it("attaches orgId and invoiceId as metadata on both session and payment_intent", async () => {
    const { client, fake } = makeClient();
    fake.checkout.sessions.create.mockResolvedValueOnce({
      url: "https://checkout.stripe.com/pay/cs_meta",
      id: "cs_meta",
    });

    await client.createCheckoutSession({ ...baseParams, orgId: "org-x", invoiceId: "inv-y" });

    const [sessionParams] = fake.checkout.sessions.create.mock.calls[0] as [
      {
        metadata: { orgId: string; invoiceId: string };
        payment_intent_data: { metadata: { orgId: string; invoiceId: string } };
      },
      unknown,
    ];
    expect(sessionParams.metadata).toEqual({ orgId: "org-x", invoiceId: "inv-y" });
    expect(sessionParams.payment_intent_data.metadata).toEqual({ orgId: "org-x", invoiceId: "inv-y" });
  });

  it("passes success_url and cancel_url through to the Stripe SDK", async () => {
    const { client, fake } = makeClient();
    fake.checkout.sessions.create.mockResolvedValueOnce({
      url: "https://checkout.stripe.com/pay/cs_urls",
      id: "cs_urls",
    });

    await client.createCheckoutSession({
      ...baseParams,
      successUrl: "https://app.example.com/paid",
      cancelUrl: "https://app.example.com/cancel",
    });

    const [sessionParams] = fake.checkout.sessions.create.mock.calls[0] as [
      { success_url: string; cancel_url: string },
      unknown,
    ];
    expect(sessionParams.success_url).toBe("https://app.example.com/paid");
    expect(sessionParams.cancel_url).toBe("https://app.example.com/cancel");
  });
});

// ---------------------------------------------------------------------------
// StripeClient.constructEvent
// ---------------------------------------------------------------------------

describe("StripeClient.constructEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the Stripe event when the signature is valid", () => {
    const { client, fake } = makeClient();
    const fakeEvent = { id: "evt_001", type: "invoice.paid", object: "event" } as unknown as Stripe.Event;
    fake.webhooks.constructEvent.mockReturnValueOnce(fakeEvent);

    const result = client.constructEvent("raw-body", "stripe-sig-header", "whsec_fake");

    expect(result).toBe(fakeEvent);
    expect(fake.webhooks.constructEvent).toHaveBeenCalledWith("raw-body", "stripe-sig-header", "whsec_fake");
  });

  it("throws a StripeSignatureVerificationError when the payload has been tampered", () => {
    const { client, fake } = makeClient();
    const sigError = new Stripe.errors.StripeSignatureVerificationError(
      "t=bad",
      "bad-body",
      { message: "No signatures found matching the expected signature for payload" },
    );
    fake.webhooks.constructEvent.mockImplementationOnce(() => {
      throw sigError;
    });

    expect(() => client.constructEvent("bad-body", "t=bad", "whsec_fake")).toThrow(
      Stripe.errors.StripeSignatureVerificationError,
    );
  });

  it("forwards the rawBody, signature, and webhookSecret as positional args", () => {
    const { client, fake } = makeClient();
    fake.webhooks.constructEvent.mockReturnValueOnce({ id: "evt_002", type: "checkout.session.completed" });

    client.constructEvent("the-body", "sig-abc", "secret-xyz");

    expect(fake.webhooks.constructEvent).toHaveBeenCalledWith("the-body", "sig-abc", "secret-xyz");
  });
});
