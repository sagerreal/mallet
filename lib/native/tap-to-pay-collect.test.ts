import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The tap, and specifically the window where money has moved and Mallet does not know it.
 *
 * `collectPayment` resolving `succeeded` means the customer's card HAS been charged on the shop's
 * connected account. Everything after that point is recording, not charging — so a failure there
 * must never be reported as a failed payment. These tests pin that distinction, because the code
 * reads fine either way and only the outcome type keeps it honest.
 */

const mutate = {
  location: vi.fn(),
  createTapPaymentIntent: vi.fn(),
  reconcileTapPayment: vi.fn(),
};
const plugin = { collectPayment: vi.fn(), prepare: vi.fn() };

vi.mock("@/lib/trpc/vanilla", () => ({
  trpcVanilla: {
    v1: {
      terminal: {
        location: { mutate: (...a: unknown[]) => mutate.location(...a) },
        createTapPaymentIntent: { mutate: (...a: unknown[]) => mutate.createTapPaymentIntent(...a) },
        reconcileTapPayment: { mutate: (...a: unknown[]) => mutate.reconcileTapPayment(...a) },
      },
    },
  },
}));
vi.mock("./tap-to-pay", () => ({ tapToPayPlugin: () => plugin }));

const { collectTapToPay, retryTapReconcile } = await import("./tap-to-pay-collect");

beforeEach(() => {
  vi.clearAllMocks();
  mutate.location.mockResolvedValue({ locationId: "tml_1", created: false });
  mutate.createTapPaymentIntent.mockResolvedValue({
    paymentIntentId: "pi_1",
    clientSecret: "pi_1_secret",
    amountCents: 31000,
  });
});

describe("collectTapToPay", () => {
  it("mints, collects, reconciles — and reports paid only once RECORDED", async () => {
    plugin.collectPayment.mockResolvedValue({ status: "succeeded", paymentIntentId: "pi_1" });
    mutate.reconcileTapPayment.mockResolvedValue({ recorded: true });

    expect(await collectTapToPay("inv_1")).toEqual({ status: "succeeded", paymentIntentId: "pi_1" });
    expect(mutate.reconcileTapPayment).toHaveBeenCalledWith({ invoiceId: "inv_1", paymentIntentId: "pi_1" });
  });

  /**
   * THE ONE THAT MATTERS. The card was charged and the reconcile failed. Reporting "failed" here
   * would tell a technician at a customer's door that the payment did not work while their
   * customer's card was debited — and the likely next action is charging them a second time.
   */
  it("a reconcile that THROWS is unreconciled, never failed", async () => {
    plugin.collectPayment.mockResolvedValue({ status: "succeeded", paymentIntentId: "pi_1" });
    mutate.reconcileTapPayment.mockRejectedValue(new Error("network died"));

    const result = await collectTapToPay("inv_1");
    expect(result.status).toBe("unreconciled");
    expect(result).toMatchObject({ paymentIntentId: "pi_1" });
  });

  /** Same, for the server answering "I did not record it" rather than erroring. */
  it("a reconcile that answers recorded:false is unreconciled, and carries the reason", async () => {
    plugin.collectPayment.mockResolvedValue({ status: "succeeded", paymentIntentId: "pi_1" });
    mutate.reconcileTapPayment.mockResolvedValue({ recorded: false, reason: "intent not succeeded" });

    const result = await collectTapToPay("inv_1");
    expect(result).toMatchObject({ status: "unreconciled", message: "intent not succeeded" });
  });

  it("cancelling charges nothing and never reconciles", async () => {
    plugin.collectPayment.mockResolvedValue({ status: "cancelled" });

    expect(await collectTapToPay("inv_1")).toEqual({ status: "cancelled" });
    expect(mutate.reconcileTapPayment).not.toHaveBeenCalled();
  });

  /** A mint failure is safe to report plainly — nothing has been charged yet. */
  it("a failure BEFORE the tap is a plain failure", async () => {
    mutate.createTapPaymentIntent.mockRejectedValue(new Error("Connect onboarding isn't finished"));

    const result = await collectTapToPay("inv_1");
    expect(result).toEqual({ status: "failed", message: "Connect onboarding isn't finished" });
    expect(plugin.collectPayment).not.toHaveBeenCalled();
  });

  it("never sends an amount — the server derives it from the invoice balance", async () => {
    plugin.collectPayment.mockResolvedValue({ status: "cancelled" });
    await collectTapToPay("inv_1");
    expect(mutate.createTapPaymentIntent).toHaveBeenCalledWith({ invoiceId: "inv_1" });
  });
});

describe("retryTapReconcile", () => {
  it("records the existing intent without touching the card again", async () => {
    mutate.reconcileTapPayment.mockResolvedValue({ recorded: true });

    expect(await retryTapReconcile("inv_1", "pi_1")).toEqual({ status: "succeeded", paymentIntentId: "pi_1" });
    expect(plugin.collectPayment).not.toHaveBeenCalled();
  });

  it("stays unreconciled when it still cannot record", async () => {
    mutate.reconcileTapPayment.mockResolvedValue({ recorded: false });
    const result = await retryTapReconcile("inv_1", "pi_1");
    expect(result.status).toBe("unreconciled");
  });
});
