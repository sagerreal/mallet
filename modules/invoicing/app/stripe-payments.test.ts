import { describe, it, expect } from "vitest";
import Stripe from "stripe";
import { TimeoutError } from "@mallet/platform/resilience";
import { isRetriableStripeError } from "@mallet/platform/adapters/stripe/stripe-client";
import {
  asOrgId,
  asLeadId,
  asInvoiceId,
  money,
  zeroMoney,
  FixedClock,
  ok,
  err,
  externalService,
  isOk,
  type OrgId,
  type InvoiceId,
  type JobId,
  type LeadId,
  type CursorPage,
  type Paginated,
} from "@mallet/shared/types";
import { InMemoryEventBus, type IdGenerator } from "@mallet/shared/ports";
import { Invoice } from "../domain/invoice";
import type { Payment } from "../domain/payment";
import type { InvoiceRepository, InvoiceFilter, ApplyResult } from "../domain/invoice-repository";
import type { PaymentLinkGateway, CreatePaymentSessionCmd } from "../domain/payment-link-gateway";
import type { ConnectTargetReader } from "../domain/connect-target-reader";
import { CreatePaymentUseCase } from "./create-payment";
import { RecordCardPaymentUseCase } from "./record-card-payment";
import { processStripeEvent } from "./stripe-webhook";

// Valid RFC v4 UUIDs (version=4, variant=8) — the webhook validates metadata with z.uuid(); in
// production these are gen_random_uuid() values.
const ORG: OrgId = asOrgId("22222222-2222-4222-8222-222222222222");
const LEAD: LeadId = asLeadId("33333333-3333-4333-8333-333333333333");
const INV = "11111111-1111-4111-8111-111111111111";

const seqIds = (): IdGenerator => {
  let n = 0;
  return { newId: () => `00000000-0000-0000-0000-${String((n += 1)).padStart(12, "0")}` };
};

const invoice = (overrides: Partial<Parameters<typeof Invoice.create>[0]> = {}): Invoice => {
  const r = Invoice.create({
    id: asInvoiceId(INV),
    orgId: ORG,
    num: "INV-1000",
    sourceJobId: null,
    leadId: LEAD,
    title: "Job",
    status: "sent",
    total: money(100_000),
    depositPaid: zeroMoney,
    amountPaid: zeroMoney,
    payments: [],
    lines: [],
    termsDays: 7,
    sentAt: new Date("2026-06-01T00:00:00Z"),
    dueAt: new Date("2026-06-08T00:00:00Z"),
    createdAt: new Date("2026-06-01T00:00:00Z"),
    updatedAt: new Date("2026-06-01T00:00:00Z"),
    ...overrides,
  });
  if (!isOk(r)) throw new Error(r.error.message);
  return r.value;
};

// Minimal fake supporting only what these use-cases touch (findById / insertPayment / applyPayment).
class FakeRepo implements InvoiceRepository {
  public current: Invoice;
  private readonly keys = new Set<string>();
  constructor(inv: Invoice) {
    this.current = inv;
  }
  async findById(): Promise<Invoice | null> {
    return this.current;
  }
  async insertPayment(_o: OrgId, _i: InvoiceId, p: Payment): Promise<boolean> {
    if (this.keys.has(p.props.idempotencyKey)) return false;
    this.keys.add(p.props.idempotencyKey);
    return true;
  }
  async applyPayment(_id: InvoiceId, amountCents: number): Promise<ApplyResult> {
    const p = this.current.props;
    // Mirror the SQL guard: only a payable (sent|partial) row is incremented.
    if (p.status !== "sent" && p.status !== "partial") return { applied: false, invoice: this.current };
    const amountPaid = money(p.amountPaid + amountCents);
    const remaining = Math.max(0, p.total - p.depositPaid - amountPaid);
    const r = Invoice.create({ ...p, amountPaid, status: remaining === 0 ? "paid" : "partial" });
    if (!isOk(r)) throw new Error(r.error.message);
    this.current = r.value;
    return { applied: true, invoice: r.value };
  }
  async nextNumber(): Promise<string> {
    return "INV-1";
  }
  async save(): Promise<void> {}
  async insertNew(): Promise<boolean> { return true; }
  async insertForJob(): Promise<boolean> {
    return true;
  }
  async findByPublicToken(): Promise<Invoice | null> {
    return null;
  }
  async listByScopeJob() { return []; }
  async findBySourceJob(): Promise<Invoice | null> {
    return null;
  }
  async totals(): Promise<{ openCents: number; overdueCents: number; openCount: number }> {
    return { openCents: 0, overdueCents: 0, openCount: 0 };
  }
  async count(): Promise<number> { return 0; }
  async list(_p: CursorPage, _f?: InvoiceFilter): Promise<Paginated<Invoice>> {
    return { items: [], nextCursor: null };
  }
  async listByLead(): Promise<Paginated<Invoice>> {
    return { items: [], nextCursor: null };
  }
  async findOverdue(): Promise<Paginated<Invoice>> {
    return { items: [], nextCursor: null };
  }
}

const okGateway: PaymentLinkGateway = {
  createPaymentSession: async () => ok({ url: "https://checkout.stripe.test/cs_1", externalRef: "cs_1" }),
};
const failGateway: PaymentLinkGateway = {
  createPaymentSession: async () => err(externalService("stripe", "down", true)),
};
// The shop has finished Connect onboarding — the happy-path precondition for taking a card.
const okConnect: ConnectTargetReader = {
  read: async () => ({ connectedAccountId: "acct_test", chargesEnabled: true }),
};
const notOnboarded: ConnectTargetReader = {
  read: async () => ({ connectedAccountId: null, chargesEnabled: false }),
};
const chargesDisabled: ConnectTargetReader = {
  read: async () => ({ connectedAccountId: "acct_test", chargesEnabled: false }),
};

describe("CreatePaymentUseCase", () => {
  it("creates a hosted payment for the balance of a sent invoice", async () => {
    const uc = new CreatePaymentUseCase(new FakeRepo(invoice()), okGateway, okConnect);
    const r = await uc.exec({ orgId: ORG, invoiceId: asInvoiceId(INV) });
    expect(isOk(r) && r.value.url).toBe("https://checkout.stripe.test/cs_1");
  });

  it("rejects a draft/paid invoice (conflict) and a zero balance (validation)", async () => {
    expect((await new CreatePaymentUseCase(new FakeRepo(invoice({ status: "draft" })), okGateway, okConnect).exec({ orgId: ORG, invoiceId: asInvoiceId(INV) })).ok).toBe(false);
    const paid = invoice({ status: "paid", amountPaid: money(100_000) });
    expect((await new CreatePaymentUseCase(new FakeRepo(paid), okGateway, okConnect).exec({ orgId: ORG, invoiceId: asInvoiceId(INV) })).ok).toBe(false);
  });

  it("propagates a gateway failure as external_service", async () => {
    const r = await new CreatePaymentUseCase(new FakeRepo(invoice()), failGateway, okConnect).exec({ orgId: ORG, invoiceId: asInvoiceId(INV) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("external_service");
  });

  it("rejects a sub-minimum balance (below Stripe's $0.50 card minimum) as validation, without calling the gateway", async () => {
    let called = false;
    const spyGateway: PaymentLinkGateway = {
      createPaymentSession: async () => {
        called = true;
        return ok({ url: "https://checkout.stripe.test/cs_x", externalRef: "cs_x" });
      },
    };
    // total $1000, $999.70 already paid → 30c balance, > 0 but < 50c.
    const inv = invoice({ status: "partial", amountPaid: money(99_970) });
    const r = await new CreatePaymentUseCase(new FakeRepo(inv), spyGateway, okConnect).exec({ orgId: ORG, invoiceId: asInvoiceId(INV) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("validation");
    expect(called).toBe(false); // never reached Stripe → no deterministic 400, no breaker hit
  });

  it("routes a destination charge to the shop's connected account with the 0.25% platform fee", async () => {
    const calls: CreatePaymentSessionCmd[] = [];
    const capturing: PaymentLinkGateway = {
      createPaymentSession: async (cmd) => {
        calls.push(cmd);
        return ok({ url: "https://checkout.stripe.test/cs_2", externalRef: "cs_2" });
      },
    };
    const r = await new CreatePaymentUseCase(new FakeRepo(invoice()), capturing, okConnect).exec({ orgId: ORG, invoiceId: asInvoiceId(INV) });
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(1);
    const cmd = calls[0];
    if (!cmd) throw new Error("gateway was not called");
    expect(cmd.connectedAccountId).toBe("acct_test");
    expect(cmd.applicationFeeCents).toBe(250); // 0.25% of the $1,000.00 balance
  });

  it("requires Connect: blocks the charge (conflict) when the shop has not onboarded, without calling Stripe", async () => {
    let called = false;
    const spy: PaymentLinkGateway = {
      createPaymentSession: async () => {
        called = true;
        return ok({ url: "x", externalRef: "x" });
      },
    };
    const r = await new CreatePaymentUseCase(new FakeRepo(invoice()), spy, notOnboarded).exec({ orgId: ORG, invoiceId: asInvoiceId(INV) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("conflict");
    expect(called).toBe(false);
  });

  it("requires Connect: blocks the charge when the connected account cannot yet take charges", async () => {
    const r = await new CreatePaymentUseCase(new FakeRepo(invoice()), okGateway, chargesDisabled).exec({ orgId: ORG, invoiceId: asInvoiceId(INV) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("conflict");
  });
});

describe("isRetriableStripeError", () => {
  it("retries only transient failures; deterministic client errors fail on the first attempt", () => {
    expect(isRetriableStripeError(new TimeoutError(10_000))).toBe(true);
    expect(isRetriableStripeError(new Stripe.errors.StripeConnectionError({ message: "conn reset" }))).toBe(true);
    expect(isRetriableStripeError(new Stripe.errors.StripeAPIError({ message: "500" }))).toBe(true);
    expect(isRetriableStripeError(new Stripe.errors.StripeRateLimitError({ message: "429" }))).toBe(true);
    // Deterministic — must NOT be retried (and thus not counted 3x toward the shared breaker):
    expect(isRetriableStripeError(new Stripe.errors.StripeInvalidRequestError({ message: "bad" }))).toBe(false);
    expect(isRetriableStripeError(new Stripe.errors.StripeAuthenticationError({ message: "no key" }))).toBe(false);
    expect(isRetriableStripeError(new Error("unknown"))).toBe(false);
  });
});

describe("RecordCardPaymentUseCase", () => {
  const deps = () => ({ bus: new InMemoryEventBus(), clock: new FixedClock(new Date("2026-06-10T00:00:00Z")), ids: seqIds() });

  it("records the settled card payment and marks the invoice paid", async () => {
    const repo = new FakeRepo(invoice());
    const d = deps();
    const uc = new RecordCardPaymentUseCase(repo, d.bus, d.clock, d.ids);
    const r = await uc.exec({ orgId: ORG, invoiceId: asInvoiceId(INV), amountCents: 100_000, paymentIntentId: "pi_abc12345" });
    expect(isOk(r) && r.value?.props.status).toBe("paid");
    expect(d.bus.recorded.some((e) => e.name === "invoice.paid")).toBe(true);
  });

  it("is idempotent on the payment_intent id (no double apply)", async () => {
    const repo = new FakeRepo(invoice());
    const d = deps();
    const uc = new RecordCardPaymentUseCase(repo, d.bus, d.clock, d.ids);
    await uc.exec({ orgId: ORG, invoiceId: asInvoiceId(INV), amountCents: 40_000, paymentIntentId: "pi_dup000001" });
    await uc.exec({ orgId: ORG, invoiceId: asInvoiceId(INV), amountCents: 40_000, paymentIntentId: "pi_dup000001" });
    expect(repo.current.props.amountPaid).toBe(40_000); // not 80000
  });

  it("does NOT apply to a non-payable invoice (voided) and emits invoice.payment.unapplied, not invoice.paid", async () => {
    // The invoice was voided before the card settled. The ledger row is claimed (real money) but the
    // atomic guard rejects the apply — no un-voiding, no paid event, and a distinct unapplied signal.
    const repo = new FakeRepo(invoice({ status: "void" }));
    const d = deps();
    const uc = new RecordCardPaymentUseCase(repo, d.bus, d.clock, d.ids);
    const r = await uc.exec({ orgId: ORG, invoiceId: asInvoiceId(INV), amountCents: 100_000, paymentIntentId: "pi_void00001" });
    expect(isOk(r)).toBe(true);
    expect(repo.current.props.amountPaid).toBe(0); // not applied
    expect(repo.current.props.status).toBe("void"); // not resurrected
    expect(d.bus.recorded.some((e) => e.name === "invoice.paid")).toBe(false);
    expect(d.bus.recorded.some((e) => e.name === "invoice.payment.recorded")).toBe(false);
    const unapplied = d.bus.recorded.find((e) => e.name === "invoice.payment.unapplied");
    expect(unapplied?.payload).toMatchObject({ invoiceId: INV, amountCents: 100_000, paymentIntentId: "pi_void00001" });
  });
});

const checkoutEvent = (o: {
  type?: string;
  paymentStatus?: string;
  metadata?: Record<string, string>;
  paymentIntent?: string | null;
  amountTotal?: number | null;
}): Stripe.Event =>
  ({
    id: "evt_1",
    type: o.type ?? "checkout.session.completed",
    data: {
      object: {
        payment_status: o.paymentStatus ?? "paid",
        metadata: o.metadata ?? { orgId: ORG, invoiceId: INV },
        payment_intent: o.paymentIntent === undefined ? "pi_123456789" : o.paymentIntent,
        amount_total: o.amountTotal === undefined ? 100_000 : o.amountTotal,
      },
    },
  }) as unknown as Stripe.Event;

describe("processStripeEvent", () => {
  const collectingDeps = () => {
    const calls: Array<{ orgId: string; invoiceId: string; cents: number; pi: string }> = [];
    return {
      calls,
      deps: {
        record: async (orgId: string, invoiceId: string, cents: number, pi: string) => {
          calls.push({ orgId, invoiceId, cents, pi });
        },
        // Every case here is an invoice payment; throwing makes an accidental route to the
        // deposit arm a loud failure instead of a silently-passing test.
        recordDeposit: async (): Promise<boolean> => {
          throw new Error("deposit recorder must not be reached by an invoice-payment session");
        },
        log: () => undefined,
      },
    };
  };

  it("records a paid checkout.session.completed with metadata + pi + amount", async () => {
    const { calls, deps } = collectingDeps();
    const res = await processStripeEvent(checkoutEvent({}), deps);
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ orgId: ORG, invoiceId: INV, cents: 100_000, pi: "pi_123456789" });
  });

  it("ignores non-paid sessions, other event types, and missing metadata (no record, 200)", async () => {
    const unpaid = collectingDeps();
    await processStripeEvent(checkoutEvent({ paymentStatus: "unpaid" }), unpaid.deps);
    expect(unpaid.calls).toHaveLength(0);

    const otherType = collectingDeps();
    await processStripeEvent(checkoutEvent({ type: "payment_intent.created" }), otherType.deps);
    expect(otherType.calls).toHaveLength(0);

    const noMeta = collectingDeps();
    const res = await processStripeEvent(checkoutEvent({ metadata: {} }), noMeta.deps);
    expect(noMeta.calls).toHaveLength(0);
    expect(res.status).toBe(200); // don't make Stripe retry an un-processable event
  });

  it("ignores an event with no payment_intent", async () => {
    const { calls } = collectingDeps();
    const d = collectingDeps();
    await processStripeEvent(checkoutEvent({ paymentIntent: null }), d.deps);
    expect(d.calls).toHaveLength(0);
    void calls;
  });
});

describe("processStripeEvent → card-on-file capture hook", () => {
  it("captures after the record, with the payment subject; deposits carry the deposit subject", async () => {
    const captures: unknown[] = [];
    const deps = {
      record: async () => undefined,
      recordDeposit: async () => true,
      captureCard: async (args: unknown) => {
        captures.push(args);
      },
      log: () => undefined,
    };
    await processStripeEvent(checkoutEvent({}), deps);
    const est = "55555555-5555-4555-8555-555555555555";
    await processStripeEvent(
      checkoutEvent({ metadata: { orgId: ORG, estimateId: est, kind: "deposit" } }),
      deps,
    );
    expect(captures).toEqual([
      { orgId: ORG, subject: { kind: "payment", invoiceId: INV }, paymentIntentId: "pi_123456789" },
      { orgId: ORG, subject: { kind: "deposit", estimateId: est }, paymentIntentId: "pi_123456789" },
    ]);
  });

  it("never captures on an unpaid session", async () => {
    const captures: unknown[] = [];
    await processStripeEvent(checkoutEvent({ paymentStatus: "unpaid" }), {
      record: async () => undefined,
      recordDeposit: async () => true,
      captureCard: async (args: unknown) => {
        captures.push(args);
      },
      log: () => undefined,
    });
    expect(captures).toHaveLength(0);
  });
});
