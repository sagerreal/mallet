/**
 * Routing a `kind:"deposit"` Checkout session — webhook AND success-page reconcile.
 *
 * Before Task 8 the webhook's metadata schema REQUIRED invoiceId, so a deposit session (which
 * carries estimateId instead) failed safeParse and was dropped as "missing/invalid metadata": a
 * logged 200, money collected by Stripe and nothing written anywhere. These tests pin the two
 * things that must now be true — a deposit session reaches the deposit recorder, and it NEVER
 * reaches the invoice payment recorder (which would credit an unrelated invoice).
 */
import { describe, it, expect } from "vitest";
import type Stripe from "stripe";
import { processStripeEvent } from "./stripe-webhook";
import { reconcileCheckoutSession, type ReconcileCheckoutDeps } from "./reconcile-checkout";

const ORG = "22222222-2222-4222-8222-222222222222";
const INV = "11111111-1111-4111-8111-111111111111";
const EST = "55555555-5555-4555-8555-555555555555";

const session = (metadata: Record<string, string>, amountTotal = 30_000): Stripe.Checkout.Session =>
  ({
    id: "cs_test_dep",
    payment_status: "paid",
    metadata,
    payment_intent: "pi_dep_1",
    amount_total: amountTotal,
  }) as unknown as Stripe.Checkout.Session;

interface Calls {
  readonly payments: Array<{ invoiceId: string; amountCents: number; paymentIntentId: string }>;
  readonly deposits: Array<{
    orgId: string;
    estimateId: string;
    amountCents: number;
    paymentRef: string;
  }>;
}

const spies = (depositResult = true) => {
  const calls: Calls = { payments: [], deposits: [] };
  const record = async (
    _orgId: string,
    invoiceId: string,
    amountCents: number,
    paymentIntentId: string,
  ) => {
    calls.payments.push({ invoiceId, amountCents, paymentIntentId });
  };
  const recordDeposit = async (
    orgId: string,
    estimateId: string,
    amountCents: number,
    paymentRef: string,
  ) => {
    calls.deposits.push({ orgId, estimateId, amountCents, paymentRef });
    return depositResult;
  };
  return { calls, record, recordDeposit };
};

const event = (s: Stripe.Checkout.Session): Stripe.Event =>
  ({ id: "evt_dep", type: "checkout.session.completed", data: { object: s } }) as unknown as Stripe.Event;

describe("stripe webhook — deposit sessions", () => {
  it("routes a kind:'deposit' session to the deposit recorder and NEVER to the invoice recorder", async () => {
    const { calls, record, recordDeposit } = spies();

    const result = await processStripeEvent(
      event(session({ orgId: ORG, estimateId: EST, kind: "deposit" })),
      { record, recordDeposit, log: () => undefined },
    );

    expect(result.status).toBe(200);
    expect(calls.deposits).toEqual([
      { orgId: ORG, estimateId: EST, amountCents: 30_000, paymentRef: "pi_dep_1" },
    ]);
    expect(calls.payments).toHaveLength(0);
  });

  it("takes the amount from Stripe's amount_total, never from metadata", async () => {
    const { calls, record, recordDeposit } = spies();

    await processStripeEvent(
      event(session({ orgId: ORG, estimateId: EST, kind: "deposit", amountCents: "999999" }, 12_345)),
      { record, recordDeposit, log: () => undefined },
    );

    expect(calls.deposits[0]!.amountCents).toBe(12_345);
  });

  it("still routes an invoice session (kind absent) to the payment recorder", async () => {
    const { calls, record, recordDeposit } = spies();

    await processStripeEvent(event(session({ orgId: ORG, invoiceId: INV }, 100_000)), {
      record,
      recordDeposit,
      log: () => undefined,
    });

    expect(calls.payments).toEqual([
      { invoiceId: INV, amountCents: 100_000, paymentIntentId: "pi_dep_1" },
    ]);
    expect(calls.deposits).toHaveLength(0);
  });

  it("answers 200 (no Stripe retry storm) when the deposit is refused, and says so in the log", async () => {
    const { calls, record, recordDeposit } = spies(false);
    const logs: string[] = [];

    const result = await processStripeEvent(
      event(session({ orgId: ORG, estimateId: EST, kind: "deposit" })),
      { record, recordDeposit, log: (m) => logs.push(m) },
    );

    expect(result.status).toBe(200);
    expect(calls.deposits).toHaveLength(1);
    expect(logs.join(" ")).toMatch(/deposit/i);
  });

  it("drops a paid deposit session with NO payment_intent — money with no identity can't dedupe", async () => {
    const { calls, record, recordDeposit } = spies();
    const noIdentity = {
      ...session({ orgId: ORG, estimateId: EST, kind: "deposit" }),
      payment_intent: null,
    } as unknown as Stripe.Checkout.Session;

    const result = await processStripeEvent(event(noIdentity), {
      record,
      recordDeposit,
      log: () => undefined,
    });

    expect(result.status).toBe(200);
    expect(calls.deposits).toHaveLength(0);
    expect(calls.payments).toHaveLength(0);
  });

  it("passes the payment_intent id the INVOICE path would have used, from the same field", async () => {
    // The two ledgers key on the same identity read the same way. If these ever diverge, the
    // webhook and the reconcile stop deduping each other's delivery of one payment.
    const { calls, record, recordDeposit } = spies();
    await processStripeEvent(event(session({ orgId: ORG, estimateId: EST, kind: "deposit" })), {
      record,
      recordDeposit,
      log: () => undefined,
    });
    const invoiceSpies = spies();
    await processStripeEvent(event(session({ orgId: ORG, invoiceId: INV })), {
      record: invoiceSpies.record,
      recordDeposit: invoiceSpies.recordDeposit,
      log: () => undefined,
    });

    expect(calls.deposits[0]!.paymentRef).toBe(invoiceSpies.calls.payments[0]!.paymentIntentId);
  });

  it("drops a deposit session with a malformed estimateId without recording anything", async () => {
    const { calls, record, recordDeposit } = spies();

    const result = await processStripeEvent(
      event(session({ orgId: ORG, estimateId: "not-a-uuid", kind: "deposit" })),
      { record, recordDeposit, log: () => undefined },
    );

    expect(result.status).toBe(200);
    expect(calls.deposits).toHaveLength(0);
    expect(calls.payments).toHaveLength(0);
  });
});

describe("reconcileCheckoutSession — deposit sessions", () => {
  const depositDeps = (
    s: Stripe.Checkout.Session,
    recorded = true,
  ): { calls: Calls; deps: ReconcileCheckoutDeps } => {
    const { calls, record, recordDeposit } = spies(recorded);
    return {
      calls,
      deps: {
        retrieveSession: async () => s,
        recordPayment: record,
        recordDeposit,
        log: () => undefined,
      },
    };
  };

  it("records the deposit against the estimate from the retrieved session", async () => {
    const { calls, deps } = depositDeps(session({ orgId: ORG, estimateId: EST, kind: "deposit" }));

    const outcome = await reconcileCheckoutSession("cs_test_dep", deps);

    expect(outcome).toEqual({ recorded: true });
    expect(calls.deposits).toEqual([
      { orgId: ORG, estimateId: EST, amountCents: 30_000, paymentRef: "pi_dep_1" },
    ]);
    expect(calls.payments).toHaveLength(0);
  });

  it("reports honestly when the deposit could not be recorded", async () => {
    const { deps } = depositDeps(session({ orgId: ORG, estimateId: EST, kind: "deposit" }), false);
    const outcome = await reconcileCheckoutSession("cs_test_dep", deps);
    expect(outcome.recorded).toBe(false);
    expect(outcome.reason).not.toBe("unsupported"); // the Task-7 placeholder is gone
  });

  it("refuses a paid deposit session with NO payment_intent — the webhook's twin", async () => {
    // Symmetric to the webhook case above, and it has to be: both paths key the ledger on the
    // payment_intent id, so a path that recorded a deposit without one would break the dedup for
    // BOTH deliveries of that money, not just its own.
    const noIdentity = {
      ...session({ orgId: ORG, estimateId: EST, kind: "deposit" }),
      payment_intent: null,
    } as unknown as Stripe.Checkout.Session;
    const { calls, deps } = depositDeps(noIdentity);

    const outcome = await reconcileCheckoutSession("cs_test_dep", deps);

    expect(outcome).toEqual({ recorded: false, reason: "missing_fields" });
    expect(calls.deposits).toHaveLength(0);
    expect(calls.payments).toHaveLength(0);
  });

  it("no-ops an unpaid deposit session", async () => {
    const s = {
      ...session({ orgId: ORG, estimateId: EST, kind: "deposit" }),
      payment_status: "unpaid",
    } as unknown as Stripe.Checkout.Session;
    const { calls, deps } = depositDeps(s);

    const outcome = await reconcileCheckoutSession("cs_test_dep", deps);

    expect(outcome.recorded).toBe(false);
    expect(calls.deposits).toHaveLength(0);
  });

  it("rejects a deposit session whose estimateId is not a uuid", async () => {
    const { calls, deps } = depositDeps(
      session({ orgId: ORG, estimateId: "nope", kind: "deposit" }),
    );
    const outcome = await reconcileCheckoutSession("cs_test_dep", deps);
    expect(outcome).toEqual({ recorded: false, reason: "invalid_metadata" });
    expect(calls.deposits).toHaveLength(0);
  });
});
