import { describe, it, expect } from "vitest";
import {
  asOrgId,
  asLeadId,
  asInvoiceId,
  money,
  zeroMoney,
  ok,
  err,
  externalService,
  isOk,
  type OrgId,
  type InvoiceId,
  type LeadId,
  type CursorPage,
  type Paginated,
} from "@mallet/shared/types";
import { Invoice } from "../domain/invoice";
import { InvoiceLine } from "../domain/invoice-line";
import type { Payment } from "../domain/payment";
import type { InvoiceRepository, InvoiceFilter, ApplyResult } from "../domain/invoice-repository";
import type { PaymentLinkGateway } from "../domain/payment-link-gateway";
import type { ConnectTargetReader } from "../domain/connect-target-reader";
import { toPublicInvoiceView, createCheckoutWithDeps } from "./public-invoice-view";

const ORG: OrgId = asOrgId("22222222-2222-4222-8222-222222222222");
const LEAD: LeadId = asLeadId("33333333-3333-4333-8333-333333333333");
const INV: InvoiceId = asInvoiceId("11111111-1111-4111-8111-111111111111");

const line = (description: string, quantity: number, rateCents: number, position: number): InvoiceLine => {
  const r = InvoiceLine.create({
    id: `44444444-4444-4444-4444-44444444444${position}`,
    sourceJobLineId: null,
    description,
    quantity,
    rate: money(rateCents),
    cost: zeroMoney,
    position,
  });
  if (!isOk(r)) throw new Error(r.error.message);
  return r.value;
};

const invoice = (overrides: Partial<Parameters<typeof Invoice.create>[0]> = {}): Invoice => {
  const now = new Date("2026-06-01T00:00:00Z");
  const r = Invoice.create({
    id: INV,
    orgId: ORG,
    num: "INV-1042",
    sourceJobId: null,
    leadId: LEAD,
    title: "Water heater swap",
    status: "sent",
    total: money(123_45),
    taxBps: 825,
    tax: money(941),
    depositPaid: money(2_000),
    amountPaid: money(1_000),
    payments: [],
    lines: [line("Labor", 2, 4_500, 0), line("Parts", 1, 3_345, 1)],
    termsDays: 14,
    sentAt: now,
    dueAt: new Date("2026-06-15T00:00:00Z"),
    poNumber: "PO-778",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });
  if (!isOk(r)) throw new Error(r.error.message);
  return r.value;
};

describe("toPublicInvoiceView", () => {
  it("maps every money figure in integer cents and derives the clamped balance", () => {
    const view = toPublicInvoiceView(invoice(), "Ridgeline Plumbing", true);

    expect(view.num).toBe("INV-1042");
    expect(view.title).toBe("Water heater swap");
    expect(view.status).toBe("sent");
    expect(view.termsDays).toBe(14);
    expect(view.dueAt).toEqual(new Date("2026-06-15T00:00:00Z"));
    expect(view.poNumber).toBe("PO-778");
    expect(view.orgName).toBe("Ridgeline Plumbing");
    expect(view.chargesEnabled).toBe(true);

    expect(view.totalCents).toBe(12_345);
    expect(view.taxCents).toBe(941);
    expect(view.depositPaidCents).toBe(2_000);
    expect(view.amountPaidCents).toBe(1_000);
    // total − deposit − paid, exactly the domain's due().
    expect(view.balanceDueCents).toBe(9_345);

    expect(view.lines).toEqual([
      { description: "Labor", quantity: 2, rateCents: 4_500 },
      { description: "Parts", quantity: 1, rateCents: 3_345 },
    ]);
  });

  it("clamps an overpaid balance to zero and passes charges-disabled through", () => {
    const paid = invoice({ status: "paid", amountPaid: money(15_000) });
    const view = toPublicInvoiceView(paid, "Ridgeline Plumbing", false);
    expect(view.balanceDueCents).toBe(0);
    expect(view.chargesEnabled).toBe(false);
    expect(view.status).toBe("paid");
  });

  it("orders lines by position regardless of input order", () => {
    const shuffled = invoice({ lines: [line("Second", 1, 200, 1), line("First", 1, 100, 0)] });
    const view = toPublicInvoiceView(shuffled, "Org", true);
    expect(view.lines.map((l) => l.description)).toEqual(["First", "Second"]);
  });
});

// Minimal fake supporting only what createCheckoutWithDeps touches (findById).
class FakeRepo implements InvoiceRepository {
  constructor(private readonly current: Invoice | null) {}
  async findById(): Promise<Invoice | null> {
    return this.current;
  }
  async findByPublicToken(): Promise<Invoice | null> {
    return this.current;
  }
  async nextNumber(): Promise<string> { return "INV-1"; }
  async save(): Promise<void> {}
  async insertNew(): Promise<boolean> { return true; }
  async insertForJob(): Promise<boolean> { return true; }
  async insertPayment(): Promise<boolean> { return true; }
  async applyPayment(): Promise<ApplyResult> { return { applied: false, invoice: null }; }
  async listByScopeJob() { return []; }
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

const okGateway: PaymentLinkGateway = {
  createPaymentSession: async () => ok({ url: "https://checkout.stripe.test/cs_1", externalRef: "cs_1" }),
};
const downGateway: PaymentLinkGateway = {
  createPaymentSession: async () => err(externalService("stripe", "down", true)),
};
const okConnect: ConnectTargetReader = {
  read: async () => ({ connectedAccountId: "acct_test", chargesEnabled: true }),
};

describe("createCheckoutWithDeps", () => {
  const deps = (inv: Invoice | null, gateway: PaymentLinkGateway = okGateway) => ({
    repo: new FakeRepo(inv),
    gateway,
    connect: okConnect,
  });

  it("returns the hosted checkout url for a sent invoice with a balance", async () => {
    const outcome = await createCheckoutWithDeps(ORG, INV, deps(invoice()));
    expect(outcome).toEqual({ kind: "ok", url: "https://checkout.stripe.test/cs_1" });
  });

  it("refuses a draft invoice", async () => {
    const draft = invoice({ status: "draft", sentAt: null, dueAt: null });
    const outcome = await createCheckoutWithDeps(ORG, INV, deps(draft));
    expect(outcome.kind).toBe("rejected");
  });

  it("refuses a paid invoice", async () => {
    const paid = invoice({ status: "paid", amountPaid: money(12_345), depositPaid: zeroMoney });
    const outcome = await createCheckoutWithDeps(ORG, INV, deps(paid));
    expect(outcome.kind).toBe("rejected");
  });

  it("maps a missing invoice to not_found", async () => {
    const outcome = await createCheckoutWithDeps(ORG, INV, deps(null));
    expect(outcome).toEqual({ kind: "not_found" });
  });

  it("maps a provider outage to unavailable, never leaking the raw error", async () => {
    const outcome = await createCheckoutWithDeps(ORG, INV, deps(invoice(), downGateway));
    expect(outcome).toEqual({ kind: "unavailable" });
  });
});
