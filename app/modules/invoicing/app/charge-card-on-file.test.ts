import { describe, it, expect } from "vitest";
import {
  asOrgId,
  asLeadId,
  asInvoiceId,
  asUserId,
  money,
  zeroMoney,
  FixedClock,
  ok,
  err,
  conflict,
  externalService,
  isOk,
  type OrgId,
  type InvoiceId,
  type LeadId,
} from "@mallet/shared/types";
import { InMemoryEventBus, type IdGenerator } from "@mallet/shared/ports";
import { platformFeeCents } from "@mallet/platform/payments/platform-fee";
import { Invoice } from "../domain/invoice";
import type { Payment } from "../domain/payment";
import type { InvoiceRepository, ApplyResult } from "../domain/invoice-repository";
import type { ConnectTargetReader } from "../domain/connect-target-reader";
import type { CardChargeGateway, ChargeSavedCardCmd } from "../domain/card-charge-gateway";
import type { PaymentProfileStore } from "../domain/payment-profile-store";
import { PaymentProfile } from "../domain/payment-profile";
import { RecordCardPaymentUseCase } from "./record-card-payment";
import { ChargeCardOnFileUseCase } from "./charge-card-on-file";

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

class FakeRepo implements InvoiceRepository {
  public current: Invoice | null;
  /** The ledger rows actually claimed — what a declined charge must leave empty. */
  public inserted: Payment[] = [];
  private readonly keys = new Set<string>();
  constructor(inv: Invoice | null) {
    this.current = inv;
  }
  async findById(): Promise<Invoice | null> {
    return this.current;
  }
  async insertPayment(_o: OrgId, _i: InvoiceId, p: Payment): Promise<boolean> {
    if (this.keys.has(p.props.idempotencyKey)) return false;
    this.keys.add(p.props.idempotencyKey);
    this.inserted.push(p);
    return true;
  }
  async applyPayment(_id: InvoiceId, amountCents: number): Promise<ApplyResult> {
    if (!this.current) return { applied: false, invoice: null };
    const p = this.current.props;
    if (p.status !== "sent" && p.status !== "partial") return { applied: false, invoice: this.current };
    const amountPaid = money(p.amountPaid + amountCents);
    const remaining = Math.max(0, p.total - p.depositPaid - amountPaid);
    const r = Invoice.create({ ...p, amountPaid, status: remaining === 0 ? "paid" : "partial" });
    if (!isOk(r)) throw new Error(r.error.message);
    this.current = r.value;
    return { applied: true, invoice: this.current };
  }
  // Unused by this use-case.
  async nextNumber(): Promise<string> {
    throw new Error("unused");
  }
  async save(): Promise<void> {
    throw new Error("unused");
  }
  async insertForJob(): Promise<boolean> {
    throw new Error("unused");
  }
  async insertNew(): Promise<boolean> {
    throw new Error("unused");
  }
  async list(): Promise<never> {
    throw new Error("unused");
  }
  async count(): Promise<number> {
    throw new Error("unused");
  }
  async totals(): Promise<never> {
    throw new Error("unused");
  }
  async listByLead(): Promise<never> {
    throw new Error("unused");
  }
  async findOverdue(): Promise<never> {
    throw new Error("unused");
  }
  async findByPublicToken(): Promise<Invoice | null> {
    throw new Error("unused");
  }
  async findBySourceJob(): Promise<Invoice | null> {
    throw new Error("unused");
  }
  async listByScopeJob(): Promise<Invoice[]> {
    throw new Error("unused");
  }
}

const profile = (): PaymentProfile => {
  const r = PaymentProfile.create({
    id: "44444444-4444-4444-8444-444444444444",
    leadId: LEAD,
    stripeCustomerId: "cus_1",
    stripePaymentMethodId: "pm_1",
    brand: "visa",
    last4: "4242",
    via: "payment",
    savedAt: new Date("2026-08-01T00:00:00Z"),
  });
  if (!isOk(r)) throw new Error(r.error.message);
  return r.value;
};

const profiles = (p: PaymentProfile | null): PaymentProfileStore => ({
  save: async () => undefined,
  findByLead: async () => p,
});

const connect = (ready = true): ConnectTargetReader => ({
  read: async () => ({ connectedAccountId: ready ? "acct_1" : null, chargesEnabled: ready }),
});

class FakeGateway implements CardChargeGateway {
  public cmds: ChargeSavedCardCmd[] = [];
  constructor(
    private readonly outcome:
      | { kind: "ok"; paymentIntentId?: string; amountReceivedCents?: number }
      | { kind: "declined"; message: string }
      | { kind: "down" },
  ) {}
  async chargeSavedCard(cmd: ChargeSavedCardCmd) {
    this.cmds.push(cmd);
    if (this.outcome.kind === "declined") return err(conflict(this.outcome.message));
    if (this.outcome.kind === "down") {
      return err(externalService("stripe", "the payment provider is temporarily unavailable", true));
    }
    return ok({
      paymentIntentId: this.outcome.paymentIntentId ?? "pi_test_1",
      amountReceivedCents: this.outcome.amountReceivedCents ?? cmd.amountCents,
    });
  }
}

const makeUseCase = (
  repo: InvoiceRepository,
  gateway: CardChargeGateway,
  store: PaymentProfileStore,
  ready = true,
) => {
  const clock = new FixedClock(new Date("2026-08-12T12:00:00Z"));
  const bus = new InMemoryEventBus();
  const recorder = new RecordCardPaymentUseCase(repo, bus, clock, seqIds());
  return {
    useCase: new ChargeCardOnFileUseCase(repo, store, gateway, connect(ready), recorder),
    bus,
  };
};

const USER = asUserId("66666666-6666-4666-8666-666666666666");
const CMD = {
  orgId: ORG,
  invoiceId: asInvoiceId(INV),
  idempotencyKey: "onfile:test-key-1",
  chargedByUserId: USER,
};

describe("ChargeCardOnFileUseCase", () => {
  it("charges the FULL balance to the saved card and records it through the idempotent card path", async () => {
    const repo = new FakeRepo(invoice({ total: money(50_000), depositPaid: money(10_000) }));
    const gateway = new FakeGateway({ kind: "ok" });
    const { useCase } = makeUseCase(repo, gateway, profiles(profile()));

    const r = await useCase.exec(CMD);
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;

    // The charge is the balance due (total − deposit), never a caller figure.
    expect(gateway.cmds[0]?.amountCents).toBe(40_000);
    expect(gateway.cmds[0]?.customerId).toBe("cus_1");
    expect(gateway.cmds[0]?.paymentMethodId).toBe("pm_1");
    expect(gateway.cmds[0]?.connectedAccountId).toBe("acct_1");
    // Fee posture identical to the Checkout path.
    expect(gateway.cmds[0]?.applicationFeeCents).toBe(platformFeeCents(40_000));
    // The ledger row is keyed on the payment intent — the same identity the webhook would use.
    expect(repo.inserted.at(-1)?.props.idempotencyKey).toBe("pi_test_1");
    expect(repo.inserted.at(-1)?.props.externalId).toBe("pi_test_1");
    // The human who tapped Charge is on the ledger row — a drawer must be reconcilable.
    expect(repo.inserted.at(-1)?.props.recordedByUserId).toBe(USER);
    expect(r.value.invoice.props.status).toBe("paid");
    expect(r.value.chargedCents).toBe(40_000);
  });

  it("records what Stripe SETTLED, not what we asked for", async () => {
    const repo = new FakeRepo(invoice({ total: money(50_000) }));
    const gateway = new FakeGateway({ kind: "ok", amountReceivedCents: 49_999 });
    const { useCase } = makeUseCase(repo, gateway, profiles(profile()));

    const r = await useCase.exec(CMD);
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect(r.value.invoice.props.amountPaid).toBe(49_999);
    expect(r.value.invoice.props.status).toBe("partial");
  });

  it("passes a decline through VERBATIM — the person at the door reads it to the customer", async () => {
    const repo = new FakeRepo(invoice());
    const gateway = new FakeGateway({ kind: "declined", message: "Your card has insufficient funds." });
    const { useCase } = makeUseCase(repo, gateway, profiles(profile()));

    const r = await useCase.exec(CMD);
    expect(isOk(r)).toBe(false);
    if (isOk(r)) return;
    expect(r.error.kind).toBe("conflict");
    expect(r.error.message).toBe("Your card has insufficient funds.");
    // A declined charge must leave the ledger untouched.
    expect(repo.inserted).toHaveLength(0);
  });

  it("refuses when there is no card on file — a precondition, not a crash", async () => {
    const repo = new FakeRepo(invoice());
    const gateway = new FakeGateway({ kind: "ok" });
    const { useCase } = makeUseCase(repo, gateway, profiles(null));

    const r = await useCase.exec(CMD);
    expect(isOk(r)).toBe(false);
    if (isOk(r)) return;
    expect(r.error.kind).toBe("precondition");
    expect(gateway.cmds).toHaveLength(0);
  });

  it("refuses a missing invoice, a draft, a settled balance, and a sub-minimum balance", async () => {
    const gateway = new FakeGateway({ kind: "ok" });

    const missing = makeUseCase(new FakeRepo(null), gateway, profiles(profile()));
    expect(isOk(await missing.useCase.exec(CMD))).toBe(false);

    const draft = makeUseCase(new FakeRepo(invoice({ status: "draft", sentAt: null, dueAt: null })), gateway, profiles(profile()));
    const rDraft = await draft.useCase.exec(CMD);
    expect(isOk(rDraft)).toBe(false);
    if (!isOk(rDraft)) expect(rDraft.error.kind).toBe("conflict");

    const settled = makeUseCase(
      new FakeRepo(invoice({ status: "paid", amountPaid: money(100_000) })),
      gateway,
      profiles(profile()),
    );
    expect(isOk(await settled.useCase.exec(CMD))).toBe(false);

    const tiny = makeUseCase(new FakeRepo(invoice({ total: money(49) })), gateway, profiles(profile()));
    const rTiny = await tiny.useCase.exec(CMD);
    expect(isOk(rTiny)).toBe(false);
    if (!isOk(rTiny)) expect(rTiny.error.kind).toBe("validation");

    // None of the refusals above may reach Stripe.
    expect(gateway.cmds).toHaveLength(0);
  });

  it("refuses when Connect onboarding is unfinished — nowhere for the money to settle", async () => {
    const repo = new FakeRepo(invoice());
    const gateway = new FakeGateway({ kind: "ok" });
    const { useCase } = makeUseCase(repo, gateway, profiles(profile()), false);

    const r = await useCase.exec(CMD);
    expect(isOk(r)).toBe(false);
    if (isOk(r)) return;
    expect(r.error.kind).toBe("precondition");
    expect(gateway.cmds).toHaveLength(0);
  });

  it("a RETRY after the money already landed refuses on status and never double-records", async () => {
    const repo = new FakeRepo(invoice({ total: money(50_000) }));
    const gateway = new FakeGateway({ kind: "ok", paymentIntentId: "pi_same_1" });
    const { useCase } = makeUseCase(repo, gateway, profiles(profile()));

    const first = await useCase.exec(CMD);
    expect(isOk(first)).toBe(true);
    // The invoice is now paid, so the status gate refuses BEFORE Stripe is dialed again — the
    // honest answer ("already paid"), and structurally zero chance of a second ledger row.
    const second = await useCase.exec(CMD);
    expect(isOk(second)).toBe(false);
    if (isOk(second)) return;
    expect(second.error.kind).toBe("conflict");
    expect(gateway.cmds).toHaveLength(1);
    expect(repo.inserted).toHaveLength(1);
    const after = await repo.findById();
    expect(after?.props.status).toBe("paid");
  });

  it("hands the gateway the SAME namespaced idempotency key the router built", async () => {
    const repo = new FakeRepo(invoice());
    const gateway = new FakeGateway({ kind: "ok" });
    const { useCase } = makeUseCase(repo, gateway, profiles(profile()));
    await useCase.exec(CMD);
    expect(gateway.cmds[0]?.idempotencyKey).toBe("onfile:test-key-1");
  });
});
