import { describe, it, expect } from "vitest";
import type Stripe from "stripe";
import {
  asOrgId,
  asLeadId,
  asInvoiceId,
  money,
  zeroMoney,
  FixedClock,
  isOk,
  type OrgId,
  type InvoiceId,
  type LeadId,
  type CursorPage,
  type Paginated,
} from "@mallet/shared/types";
import { InMemoryEventBus, type IdGenerator } from "@mallet/shared/ports";
import { Invoice } from "../domain/invoice";
import type { Payment } from "../domain/payment";
import type { InvoiceRepository, InvoiceFilter, ApplyResult } from "../domain/invoice-repository";
import { RecordCardPaymentUseCase } from "./record-card-payment";
import { processStripeEvent } from "./stripe-webhook";
import { reconcileCheckoutSession, type ReconcileCheckoutDeps } from "./reconcile-checkout";

const ORG: OrgId = asOrgId("22222222-2222-4222-8222-222222222222");
const LEAD: LeadId = asLeadId("33333333-3333-4333-8333-333333333333");
const INV = "11111111-1111-4111-8111-111111111111";

const invoice = (): Invoice => {
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
  });
  if (!isOk(r)) throw new Error(r.error.message);
  return r.value;
};

const seqIds = (): IdGenerator => {
  let n = 0;
  return { newId: () => `00000000-0000-0000-0000-${String((n += 1)).padStart(12, "0")}` };
};

// Ledger-faithful fake: dedups on the idempotency key exactly like payments_org_idem_uidx.
class FakeRepo implements InvoiceRepository {
  public current: Invoice;
  public ledgerRows = 0;
  private readonly keys = new Set<string>();
  constructor(inv: Invoice) {
    this.current = inv;
  }
  async findById(): Promise<Invoice | null> { return this.current; }
  async findByPublicToken(): Promise<Invoice | null> { return this.current; }
  async insertPayment(_o: OrgId, _i: InvoiceId, p: Payment): Promise<boolean> {
    if (this.keys.has(p.props.idempotencyKey)) return false;
    this.keys.add(p.props.idempotencyKey);
    this.ledgerRows += 1;
    return true;
  }
  async applyPayment(_id: InvoiceId, amountCents: number): Promise<ApplyResult> {
    const p = this.current.props;
    if (p.status !== "sent" && p.status !== "partial") return { applied: false, invoice: this.current };
    const amountPaid = money(p.amountPaid + amountCents);
    const remaining = Math.max(0, p.total - p.depositPaid - amountPaid);
    const r = Invoice.create({ ...p, amountPaid, status: remaining === 0 ? "paid" : "partial" });
    if (!isOk(r)) throw new Error(r.error.message);
    this.current = r.value;
    return { applied: true, invoice: r.value };
  }
  async nextNumber(): Promise<string> { return "INV-1"; }
  async save(): Promise<void> {}
  async insertForJob(): Promise<boolean> { return true; }
  async findBySourceJob(): Promise<Invoice | null> { return null; }
  async totals(): Promise<{ openCents: number; overdueCents: number; openCount: number }> {
    return { openCents: 0, overdueCents: 0, openCount: 0 };
  }
  async count(): Promise<number> { return 0; }
  async list(_p: CursorPage, _f?: InvoiceFilter): Promise<Paginated<Invoice>> {
    return { items: [], nextCursor: null };
  }
  async listByLead(): Promise<Paginated<Invoice>> { return { items: [], nextCursor: null }; }
  async findOverdue(): Promise<Paginated<Invoice>> { return { items: [], nextCursor: null }; }
}

const session = (o: {
  paymentStatus?: string;
  metadata?: Record<string, string>;
  paymentIntent?: string | null;
  amountTotal?: number | null;
} = {}): Stripe.Checkout.Session =>
  ({
    id: "cs_test_abc123",
    payment_status: o.paymentStatus ?? "paid",
    metadata: o.metadata ?? { orgId: ORG, invoiceId: INV },
    payment_intent: o.paymentIntent === undefined ? "pi_123456789" : o.paymentIntent,
    amount_total: o.amountTotal === undefined ? 100_000 : o.amountTotal,
  }) as unknown as Stripe.Checkout.Session;

interface RecordCall {
  orgId: string;
  invoiceId: string;
  amountCents: number;
  paymentIntentId: string;
}

// Every case in THIS file is an invoice payment. A deposit recorder that throws makes any
// accidental routing to the deposit arm a loud failure rather than a silently-passing test.
const noDeposits = async (): Promise<boolean> => {
  throw new Error("deposit recorder must not be reached by an invoice-payment session");
};

const collectingDeps = (s: Stripe.Checkout.Session) => {
  const calls: RecordCall[] = [];
  const deps: ReconcileCheckoutDeps = {
    retrieveSession: async () => s,
    recordPayment: async (orgId, invoiceId, amountCents, paymentIntentId) => {
      calls.push({ orgId, invoiceId, amountCents, paymentIntentId });
    },
    recordDeposit: noDeposits,
    log: () => undefined,
  };
  return { calls, deps };
};

describe("reconcileCheckoutSession", () => {
  it("records a paid session keyed on its payment_intent id", async () => {
    const { calls, deps } = collectingDeps(session());
    const outcome = await reconcileCheckoutSession("cs_test_abc123", deps);
    expect(outcome.recorded).toBe(true);
    expect(calls).toEqual([
      { orgId: ORG, invoiceId: INV, amountCents: 100_000, paymentIntentId: "pi_123456789" },
    ]);
  });

  it("routes metadata.kind 'payment' (explicit) to the payment recorder", async () => {
    const { calls, deps } = collectingDeps(
      session({ metadata: { orgId: ORG, invoiceId: INV, kind: "payment" } }),
    );
    const outcome = await reconcileCheckoutSession("cs_test_abc123", deps);
    expect(outcome.recorded).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it("no-ops an unpaid session", async () => {
    const { calls, deps } = collectingDeps(session({ paymentStatus: "unpaid" }));
    const outcome = await reconcileCheckoutSession("cs_test_abc123", deps);
    expect(outcome.recorded).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("rejects bad metadata without recording", async () => {
    const { calls, deps } = collectingDeps(session({ metadata: { orgId: "not-a-uuid" } }));
    const outcome = await reconcileCheckoutSession("cs_test_abc123", deps);
    expect(outcome.recorded).toBe(false);
    expect(calls).toHaveLength(0);
  });

  // A deposit session carries estimateId, never invoiceId — so an invoice-shaped one tagged
  // kind:"deposit" is malformed metadata, not a deposit. It must reach NEITHER recorder.
  // The live deposit arm is covered in deposit-routing.test.ts.
  it("refuses a deposit-tagged session that carries no estimateId, without recording", async () => {
    const { calls, deps } = collectingDeps(
      session({ metadata: { orgId: ORG, invoiceId: INV, kind: "deposit" } }),
    );
    const outcome = await reconcileCheckoutSession("cs_test_abc123", deps);
    expect(outcome).toEqual({ recorded: false, reason: "invalid_metadata" });
    expect(calls).toHaveLength(0);
  });

  it("no-ops a session missing its payment_intent or amount", async () => {
    const noPi = collectingDeps(session({ paymentIntent: null }));
    expect((await reconcileCheckoutSession("cs_x", noPi.deps)).recorded).toBe(false);
    expect(noPi.calls).toHaveLength(0);

    const noAmount = collectingDeps(session({ amountTotal: null }));
    expect((await reconcileCheckoutSession("cs_x", noAmount.deps)).recorded).toBe(false);
    expect(noAmount.calls).toHaveLength(0);
  });

  // Wire the real RecordCardPaymentUseCase behind the deps so the idempotency claim is proven
  // against the actual ledger path, not a spy.
  const recordingDeps = (repo: FakeRepo, s: Stripe.Checkout.Session): ReconcileCheckoutDeps => {
    const bus = new InMemoryEventBus();
    const clock = new FixedClock(new Date("2026-06-10T00:00:00Z"));
    const ids = seqIds();
    return {
      retrieveSession: async () => s,
      recordPayment: async (orgId, invoiceId, amountCents, paymentIntentId) => {
        const uc = new RecordCardPaymentUseCase(repo, bus, clock, ids);
        const r = await uc.exec({
          orgId: asOrgId(orgId),
          invoiceId: asInvoiceId(invoiceId),
          amountCents,
          paymentIntentId,
        });
        if (!r.ok) throw new Error(r.error.message);
      },
      recordDeposit: noDeposits,
      log: () => undefined,
    };
  };

  it("dedups: reconciling the same session twice leaves exactly one ledger row", async () => {
    const repo = new FakeRepo(invoice());
    const deps = recordingDeps(repo, session());

    const first = await reconcileCheckoutSession("cs_test_abc123", deps);
    const second = await reconcileCheckoutSession("cs_test_abc123", deps);

    expect(first.recorded).toBe(true);
    expect(second.recorded).toBe(true); // the money IS recorded — just not twice
    expect(repo.ledgerRows).toBe(1);
    expect(repo.current.props.amountPaid).toBe(100_000); // applied once
  });

  it("dedups against the WEBHOOK: both record under the identical payment_intent key", async () => {
    const repo = new FakeRepo(invoice());
    const bus = new InMemoryEventBus();
    const clock = new FixedClock(new Date("2026-06-10T00:00:00Z"));
    const ids = seqIds();
    const record = async (orgId: string, invoiceId: string, amountCents: number, paymentIntentId: string) => {
      const uc = new RecordCardPaymentUseCase(repo, bus, clock, ids);
      const r = await uc.exec({
        orgId: asOrgId(orgId),
        invoiceId: asInvoiceId(invoiceId),
        amountCents,
        paymentIntentId,
      });
      if (!r.ok) throw new Error(r.error.message);
    };

    // 1. The webhook lands first (its idempotency key is the payment_intent id).
    await processStripeEvent(
      {
        id: "evt_1",
        type: "checkout.session.completed",
        data: { object: session() },
      } as unknown as Stripe.Event,
      { record, recordDeposit: noDeposits, log: () => undefined },
    );

    // 2. The success-page reconcile fires for the SAME session.
    const outcome = await reconcileCheckoutSession("cs_test_abc123", {
      retrieveSession: async () => session(),
      recordPayment: record,
      recordDeposit: noDeposits,
      log: () => undefined,
    });

    expect(outcome.recorded).toBe(true);
    expect(repo.ledgerRows).toBe(1); // one row, not two — the keys are identical
    expect(repo.current.props.amountPaid).toBe(100_000);
  });
});
