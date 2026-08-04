import { describe, it, expect } from "vitest";
import {
  asOrgId,
  asLeadId,
  asInvoiceId,
  asUserId,
  money,
  zeroMoney,
  FixedClock,
  isOk,
  type OrgId,
  type InvoiceId,
  type UserId,
  type CursorPage,
  type Paginated,
} from "@mallet/shared/types";
import { InMemoryEventBus, type IdGenerator } from "@mallet/shared/ports";
import { Invoice } from "../domain/invoice";
import type { Payment } from "../domain/payment";
import type { InvoiceRepository, InvoiceFilter, ApplyResult } from "../domain/invoice-repository";
import { ManualPaymentGateway } from "../infra/manual-payment-gateway";
import { RecordPaymentUseCase } from "./record-payment";
import { RecordCardPaymentUseCase } from "./record-card-payment";

// The ledger has to answer "which staffer is holding this cash" before a tech is allowed to take it
// at the door. These lock the two halves of that: the stamp comes from the authenticated principal,
// and nothing the client can type reaches the column.

const ORG: OrgId = asOrgId("22222222-2222-4222-8222-222222222222");
const LEAD = asLeadId("33333333-3333-4333-8333-333333333333");
const INV = "11111111-1111-4111-8111-111111111111";
const TECH: UserId = asUserId("55555555-5555-4555-8555-555555555555");
const OTHER_TECH: UserId = asUserId("66666666-6666-4666-8666-666666666666");
// What an attacker would try to smuggle in through a client-controlled field.
const ROGUE = "99999999-9999-4999-8999-999999999999";

const seqIds = (): IdGenerator => {
  let n = 0;
  return { newId: () => `00000000-0000-0000-0000-${String((n += 1)).padStart(12, "0")}` };
};

const sentInvoice = (): Invoice => {
  const r = Invoice.create({
    id: asInvoiceId(INV),
    orgId: ORG,
    num: "INV-1000",
    sourceJobId: null,
    leadId: LEAD,
    title: "Water heater",
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

// Minimal fake that KEEPS every appended ledger row, so the tests can read the stamp that was
// actually written rather than the one the use case says it wrote.
class CapturingRepo implements InvoiceRepository {
  public current: Invoice = sentInvoice();
  public readonly appended: Payment[] = [];
  private readonly keys = new Set<string>();

  async insertPayment(_o: OrgId, _i: InvoiceId, p: Payment): Promise<boolean> {
    if (this.keys.has(p.props.idempotencyKey)) return false; // append-only: a retry writes nothing
    this.keys.add(p.props.idempotencyKey);
    this.appended.push(p);
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
  async findById(): Promise<Invoice | null> {
    return this.current;
  }
  async nextNumber(): Promise<string> {
    return "INV-1";
  }
  async save(): Promise<void> {}
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
  async count(_f?: InvoiceFilter): Promise<number> {
    return 0;
  }
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

const clock = new FixedClock(new Date("2026-06-05T12:00:00Z"));

const record = async (
  repo: CapturingRepo,
  overrides: { readonly recordedByUserId: UserId | null; readonly idempotencyKey?: string },
) =>
  new RecordPaymentUseCase(repo, new ManualPaymentGateway(clock), new InMemoryEventBus(), clock, seqIds()).exec({
    orgId: ORG,
    invoiceId: asInvoiceId(INV),
    amount: money(10_000),
    method: "cash",
    idempotencyKey: overrides.idempotencyKey ?? "attrib-key-0001",
    recordedByUserId: overrides.recordedByUserId,
  });

describe("recordPayment — who took the money", () => {
  it("stamps the ledger row with the principal's user id", async () => {
    const repo = new CapturingRepo();
    const r = await record(repo, { recordedByUserId: TECH });

    expect(isOk(r)).toBe(true);
    expect(repo.appended).toHaveLength(1);
    expect(repo.appended[0]?.props.recordedByUserId).toBe(TECH);
  });

  it("records null — not a guess — when there is no in-app actor", async () => {
    // Null is a real answer ("nobody in the app took this"), not a missing one. It must still write.
    const repo = new CapturingRepo();
    const r = await record(repo, { recordedByUserId: null });

    expect(isOk(r)).toBe(true);
    expect(repo.appended[0]?.props.recordedByUserId).toBeNull();
  });

  it("a card payment settled by the customer online is attributed to nobody", async () => {
    // The Stripe webhook path has no principal. Blaming whoever sent the invoice would be a lie on
    // an audit column, so it stays null.
    const repo = new CapturingRepo();
    const r = await new RecordCardPaymentUseCase(repo, new InMemoryEventBus(), clock, seqIds()).exec({
      orgId: ORG,
      invoiceId: asInvoiceId(INV),
      amountCents: 10_000,
      paymentIntentId: "pi_attrib_0001",
    });

    expect(isOk(r)).toBe(true);
    expect(repo.appended[0]?.props.recordedByUserId).toBeNull();
  });

  it("never takes the actor from a client-controlled field", async () => {
    // Everything the caller can type — amount, method, idempotency key — carries the rogue id here.
    // The only thing that reaches the column is the principal stamp.
    const repo = new CapturingRepo();
    const r = await record(repo, { recordedByUserId: TECH, idempotencyKey: `key-${ROGUE}` });

    expect(isOk(r)).toBe(true);
    const stamped = repo.appended[0]?.props.recordedByUserId;
    expect(stamped).toBe(TECH);
    expect(stamped).not.toBe(ROGUE);
  });

  it("a retry cannot re-attribute a payment someone else already recorded", async () => {
    // Append-only, write-once: the second call short-circuits on the claimed idempotency key, so no
    // second row is written and the original actor stands. Otherwise a tech could replay a
    // colleague's key and move the blame for a drawer that does not balance.
    const repo = new CapturingRepo();
    await record(repo, { recordedByUserId: TECH, idempotencyKey: "attrib-key-retry" });
    const second = await record(repo, { recordedByUserId: OTHER_TECH, idempotencyKey: "attrib-key-retry" });

    expect(isOk(second)).toBe(true);
    expect(repo.appended).toHaveLength(1);
    expect(repo.appended[0]?.props.recordedByUserId).toBe(TECH);
  });

  it("will not compile a call site that forgets attribution", async () => {
    // The command field is REQUIRED, not optional: a new caller (the field router next) cannot drop
    // the stamp by omission. If this stops erroring, the guarantee is gone.
    const repo = new CapturingRepo();
    const uc = new RecordPaymentUseCase(
      repo,
      new ManualPaymentGateway(clock),
      new InMemoryEventBus(),
      clock,
      seqIds(),
    );
    const r = await uc.exec({
      orgId: ORG,
      invoiceId: asInvoiceId(INV),
      amount: money(10_000),
      method: "cash",
      idempotencyKey: "attrib-key-typed",
      // @ts-expect-error recordedByUserId is required — omitting it must be a compile error.
      recordedByUserId: undefined,
    });
    expect(isOk(r)).toBe(true);
  });
});
