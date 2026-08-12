import { describe, it, expect, vi } from "vitest";
import { reconcileTapPayment, type ReconcileTapPaymentDeps } from "./reconcile-tap-payment";
import type { RetrievedTapIntent } from "../domain/terminal-gateway";

const ORG = "22222222-2222-4222-8222-222222222222";
const INV = "11111111-1111-4111-8111-111111111111";
const PI = "pi_tap00001";

const succeededIntent = (overrides: Partial<RetrievedTapIntent> = {}): RetrievedTapIntent => ({
  paymentIntentId: PI,
  status: "succeeded",
  amountReceivedCents: 100_000,
  metadata: { orgId: ORG, invoiceId: INV, kind: "tap" },
  ...overrides,
});

const depsWith = (intent: RetrievedTapIntent) => {
  const recordPayment = vi.fn(async () => {});
  const log = vi.fn();
  const deps: ReconcileTapPaymentDeps = {
    retrieveIntent: async () => intent,
    recordPayment,
    log,
  };
  return { deps, recordPayment, log };
};

const cmd = { orgId: ORG, invoiceId: INV, paymentIntentId: PI };

describe("reconcileTapPayment", () => {
  it("records a succeeded tap intent through the idempotent card-payment path", async () => {
    const { deps, recordPayment } = depsWith(succeededIntent());
    const r = await reconcileTapPayment(cmd, deps);
    expect(r).toEqual({ recorded: true });
    // Keyed on the payment_intent id — the SAME identity every card recorder dedups on.
    expect(recordPayment).toHaveBeenCalledWith(INV, 100_000, PI);
  });

  it("records what Stripe RECEIVED, never what the caller claims", async () => {
    const { deps, recordPayment } = depsWith(succeededIntent({ amountReceivedCents: 40_000 }));
    await reconcileTapPayment(cmd, deps);
    expect(recordPayment).toHaveBeenCalledWith(INV, 40_000, PI);
  });

  it("does nothing while the intent has not succeeded (still collecting / requires_payment_method)", async () => {
    const { deps, recordPayment } = depsWith(succeededIntent({ status: "requires_payment_method" }));
    const r = await reconcileTapPayment(cmd, deps);
    expect(r).toEqual({ recorded: false, reason: "not_succeeded" });
    expect(recordPayment).not.toHaveBeenCalled();
  });

  it("refuses an intent that is not a tap payment (wrong kind) — a Checkout pi must not be re-recorded here", async () => {
    const { deps, recordPayment, log } = depsWith(
      succeededIntent({ metadata: { orgId: ORG, invoiceId: INV, kind: "payment" } }),
    );
    const r = await reconcileTapPayment(cmd, deps);
    expect(r).toEqual({ recorded: false, reason: "wrong_target" });
    expect(recordPayment).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalled();
  });

  it("refuses an intent whose metadata names another org or another invoice", async () => {
    const otherOrg = await reconcileTapPayment(
      cmd,
      depsWith(succeededIntent({ metadata: { orgId: "99999999-9999-4999-8999-999999999999", invoiceId: INV, kind: "tap" } })).deps,
    );
    expect(otherOrg).toEqual({ recorded: false, reason: "wrong_target" });

    const { deps, recordPayment } = depsWith(
      succeededIntent({ metadata: { orgId: ORG, invoiceId: "44444444-4444-4444-8444-444444444444", kind: "tap" } }),
    );
    const otherInvoice = await reconcileTapPayment(cmd, deps);
    expect(otherInvoice).toEqual({ recorded: false, reason: "wrong_target" });
    expect(recordPayment).not.toHaveBeenCalled();
  });

  it("refuses a zero received amount rather than recording $0", async () => {
    const { deps, recordPayment } = depsWith(succeededIntent({ amountReceivedCents: 0 }));
    const r = await reconcileTapPayment(cmd, deps);
    expect(r).toEqual({ recorded: false, reason: "missing_fields" });
    expect(recordPayment).not.toHaveBeenCalled();
  });

  it("lets a transient retrieve failure throw — the caller answers 5xx and the device retries", async () => {
    const deps: ReconcileTapPaymentDeps = {
      retrieveIntent: async () => {
        throw new Error("stripe timeout");
      },
      recordPayment: vi.fn(async () => {}),
      log: vi.fn(),
    };
    await expect(reconcileTapPayment(cmd, deps)).rejects.toThrow("stripe timeout");
  });
});
