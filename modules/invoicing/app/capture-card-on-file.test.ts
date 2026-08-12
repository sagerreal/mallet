import { describe, it, expect } from "vitest";
import { captureCardOnFile, type CaptureCardArgs, type CaptureCardDeps } from "./capture-card-on-file";

const ARGS: CaptureCardArgs = {
  orgId: "22222222-2222-4222-8222-222222222222",
  subject: { kind: "payment", invoiceId: "11111111-1111-4111-8111-111111111111" },
  paymentIntentId: "pi_test_123",
};

const CARD = { customerId: "cus_1", paymentMethodId: "pm_1", brand: "visa", last4: "4242" };

interface Recorded {
  saves: unknown[];
  logs: string[];
}

const deps = (
  overrides: Partial<CaptureCardDeps> = {},
): { deps: CaptureCardDeps; seen: Recorded } => {
  const seen: Recorded = { saves: [], logs: [] };
  return {
    seen,
    deps: {
      retrieveCard: async () => CARD,
      saveProfile: async (args) => {
        seen.saves.push(args);
        return true;
      },
      log: (message) => seen.logs.push(message),
      ...overrides,
    },
  };
};

describe("captureCardOnFile", () => {
  it("saves the card with via matching the subject kind", async () => {
    const { deps: d, seen } = deps();
    const r = await captureCardOnFile(ARGS, d);
    expect(r.saved).toBe(true);
    expect(seen.saves[0]).toEqual({
      orgId: ARGS.orgId,
      subject: ARGS.subject,
      card: CARD,
      via: "payment",
    });

    const dep = await captureCardOnFile(
      { ...ARGS, subject: { kind: "deposit", estimateId: "55555555-5555-4555-8555-555555555555" } },
      d,
    );
    expect(dep.saved).toBe(true);
    expect((seen.saves[1] as { via: string }).via).toBe("deposit");
  });

  it("does nothing when Stripe saved no reusable card (pre-feature sessions, wallets)", async () => {
    const { deps: d, seen } = deps({ retrieveCard: async () => null });
    const r = await captureCardOnFile(ARGS, d);
    expect(r).toEqual({ saved: false, reason: "nothing_saved" });
    expect(seen.saves).toHaveLength(0);
    // Nothing to log loudly about — an unsaved card is the normal case for old sessions.
    expect(seen.logs).toHaveLength(0);
  });

  it("does nothing when there is no payment intent to read from", async () => {
    const { deps: d, seen } = deps();
    const r = await captureCardOnFile({ ...ARGS, paymentIntentId: null }, d);
    expect(r).toEqual({ saved: false, reason: "no_intent" });
    expect(seen.saves).toHaveLength(0);
  });

  it("NEVER throws — a capture failure is logged, and the money path already succeeded", async () => {
    const { deps: d, seen } = deps({
      retrieveCard: async () => {
        throw new Error("stripe fell over");
      },
    });
    const r = await captureCardOnFile(ARGS, d);
    expect(r).toEqual({ saved: false, reason: "error" });
    expect(seen.logs).toHaveLength(1);

    const failingSave = deps({
      saveProfile: async () => {
        throw new Error("db fell over");
      },
    });
    const r2 = await captureCardOnFile(ARGS, failingSave.deps);
    expect(r2).toEqual({ saved: false, reason: "error" });
    expect(failingSave.seen.logs).toHaveLength(1);
  });

  it("reports (and logs nothing loud) when the subject cannot hold the card — customer gone", async () => {
    const { deps: d } = deps({ saveProfile: async () => false });
    const r = await captureCardOnFile(ARGS, d);
    expect(r).toEqual({ saved: false, reason: "no_lead" });
  });
});
