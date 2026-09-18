import { describe, it, expect } from "vitest";
import {
  asOrgId,
  asLeadId,
  asInvoiceId,
  asUserId,
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
import { Payment, type PaymentMethod } from "../domain/payment";
import type { InvoiceRepository, InvoiceFilter, ApplyResult } from "../domain/invoice-repository";
import type { PaymentLinkGateway } from "../domain/payment-link-gateway";
import type { ConnectTargetReader } from "../domain/connect-target-reader";
import {
  toPublicInvoiceView,
  createCheckoutWithDeps,
  type PublicInvoiceContext,
} from "./public-invoice-view";

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

let paymentSeq = 0;
const payment = (amountCents: number, method: PaymentMethod, receivedAt: string): Payment => {
  paymentSeq += 1;
  const r = Payment.create({
    id: `55555555-5555-4555-8555-55555555555${paymentSeq % 10}`,
    amount: money(amountCents),
    method,
    idempotencyKey: `idem-key-${paymentSeq}-abcdefgh`,
    externalId: null,
    recordedByUserId: asUserId("66666666-6666-4666-8666-666666666666"),
    receivedAt: new Date(receivedAt),
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

/** A shop that has filled nothing in and a lead with no address — the barest honest context. */
const BARE_CONTEXT: PublicInvoiceContext = {
  orgName: "Org",
  chargesEnabled: true,
  business: { address: null, phone: null, email: null, site: null, license: null },
  customerName: null,
  customerPhone: null,
  customerEmail: null,
  serviceAddress: null,
  serviceAt: null,
  wording: { invoiceFooter: null, payInstructions: null, receiptNote: null },
  authorization: null,
};

const ctx = (overrides: Partial<PublicInvoiceContext> = {}): PublicInvoiceContext => ({
  ...BARE_CONTEXT,
  ...overrides,
});

describe("toPublicInvoiceView document wording", () => {
  it("resolves the standard sentences when the shop never touched the slots", () => {
    const view = toPublicInvoiceView(invoice(), ctx({ orgName: "Ridgeline Plumbing" }));
    // No footer existed before the slot did — an untouched org renders exactly nothing there.
    expect(view.footerNote).toBeNull();
    expect(view.payInstructions).toBe(
      "To pay this invoice, contact Ridgeline Plumbing directly.",
    );
    expect(view.receiptNote).toBe(
      "This invoice is settled in full. Keep this link for your records.",
    );
  });

  it("carries the shop's overrides verbatim", () => {
    const view = toPublicInvoiceView(
      invoice(),
      ctx({
        wording: {
          invoiceFooter: "1-year warranty on labor.",
          payInstructions: "Zelle to (925) 555-0100.",
          receiptNote: "Paid in full — thank you!",
        },
      }),
    );
    expect(view.footerNote).toBe("1-year warranty on labor.");
    expect(view.payInstructions).toBe("Zelle to (925) 555-0100.");
    expect(view.receiptNote).toBe("Paid in full — thank you!");
  });

  it("treats a blank override as standard — a stored space must never blank the line", () => {
    const view = toPublicInvoiceView(
      invoice(),
      ctx({ wording: { invoiceFooter: "  ", payInstructions: "", receiptNote: " " } }),
    );
    expect(view.footerNote).toBeNull();
    expect(view.payInstructions).toBe("To pay this invoice, contact Org directly.");
    expect(view.receiptNote).toBe(
      "This invoice is settled in full. Keep this link for your records.",
    );
  });
});

describe("toPublicInvoiceView", () => {
  it("maps every money figure in integer cents and derives the clamped balance", () => {
    const view = toPublicInvoiceView(invoice(), ctx({ orgName: "Ridgeline Plumbing" }));

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
      { description: "Labor", quantity: 2, rateCents: 4_500, taxable: true },
      { description: "Parts", quantity: 1, rateCents: 3_345, taxable: true },
    ]);
  });

  it("clamps an overpaid balance to zero and passes charges-disabled through", () => {
    const paid = invoice({ status: "paid", amountPaid: money(15_000) });
    const view = toPublicInvoiceView(paid, ctx({ orgName: "Ridgeline Plumbing", chargesEnabled: false }));
    expect(view.balanceDueCents).toBe(0);
    expect(view.chargesEnabled).toBe(false);
    expect(view.status).toBe("paid");
  });

  it("orders lines by position regardless of input order", () => {
    const shuffled = invoice({ lines: [line("Second", 1, 200, 1), line("First", 1, 100, 0)] });
    const view = toPublicInvoiceView(shuffled, ctx());
    expect(view.lines.map((l) => l.description)).toEqual(["First", "Second"]);
  });

  it("projects each payment's amount, method and date — what makes the page a RECEIPT", () => {
    // The aggregate amountPaidCents was always here; the payment ROWS were not, so the page could
    // not state when the money arrived, how much of it, or by what means.
    const view = toPublicInvoiceView(
      invoice({ payments: [payment(6_000, "cash", "2026-06-03T10:00:00Z")] }),
      ctx(),
    );
    expect(view.payments).toEqual([
      { amountCents: 6_000, method: "cash", receivedAt: new Date("2026-06-03T10:00:00Z") },
    ]);
  });

  it("orders payments OLDEST FIRST — a receipt reads in the order the money arrived", () => {
    const view = toPublicInvoiceView(
      invoice({
        payments: [
          payment(2_000, "card", "2026-06-09T10:00:00Z"),
          payment(1_000, "check", "2026-06-02T10:00:00Z"),
        ],
      }),
      ctx(),
    );
    expect(view.payments.map((p) => p.amountCents)).toEqual([1_000, 2_000]);
  });

  it("projects NO reconciliation data — the acting user and the ledger keys stay in the shop", () => {
    const view = toPublicInvoiceView(
      invoice({ payments: [payment(6_000, "cash", "2026-06-03T10:00:00Z")] }),
      ctx(),
    );
    expect(Object.keys(view.payments[0] ?? {}).sort()).toEqual(["amountCents", "method", "receivedAt"]);
  });

  it("has an empty payments list when nothing has been collected", () => {
    expect(toPublicInvoiceView(invoice(), ctx()).payments).toEqual([]);
  });

  // ── document of record: who billed, who was billed, where and when ────────────────────────

  it("carries the identity block, the parties and both dates", () => {
    const view = toPublicInvoiceView(
      invoice(),
      ctx({
        business: {
          address: "200 Ray St, Pleasanton, CA 94566",
          phone: "(925) 555-0100",
          email: "billing@ridgeline.test",
          site: "ridgelineplumbing.com",
          license: "C36-1029384",
        },
        customerName: "Dana Whitfield",
        serviceAddress: "18 Aspen Ct, Dublin, CA 94568",
        serviceAt: new Date("2026-05-29T16:20:00Z"),
      }),
    );

    expect(view.business.license).toBe("C36-1029384");
    expect(view.business.phone).toBe("(925) 555-0100");
    expect(view.customerName).toBe("Dana Whitfield");
    expect(view.serviceAddress).toBe("18 Aspen Ct, Dublin, CA 94568");
    // The bill's own creation stamp, straight off the record.
    expect(view.invoicedAt).toEqual(new Date("2026-06-01T00:00:00Z"));
    expect(view.serviceAt).toEqual(new Date("2026-05-29T16:20:00Z"));
  });

  it("states an UNKNOWN service date as null — never the invoice date wearing a Service label", () => {
    // The whole reason serviceAt is separate. A customer may hand this page to an insurer or a
    // warranty desk; a bill with no completed visit says nothing rather than something untrue.
    const view = toPublicInvoiceView(invoice(), ctx({ serviceAt: null }));
    expect(view.serviceAt).toBeNull();
    expect(view.invoicedAt).toEqual(new Date("2026-06-01T00:00:00Z"));
  });

  it("passes an unfilled shop and an addressless lead through as nulls, not blanks", () => {
    // Blank strings would render as empty labels on the customer's page — the documented failure
    // mode <InvoiceDocument> exists to avoid. Null is what "not set" has to look like.
    const view = toPublicInvoiceView(invoice(), ctx());
    expect(view.business).toEqual({
      address: null,
      phone: null,
      email: null,
      site: null,
      license: null,
    });
    expect(view.customerName).toBeNull();
    expect(view.serviceAddress).toBeNull();
  });

  it("never projects the shop's NAME into the business block — the branded header prints it", () => {
    const view = toPublicInvoiceView(invoice(), ctx({ orgName: "Ridgeline Plumbing" }));
    expect(Object.keys(view.business).sort()).toEqual([
      "address",
      "email",
      "license",
      "phone",
      "site",
    ]);
    expect(view.orgName).toBe("Ridgeline Plumbing");
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

describe("toPublicInvoiceView — what the customer signed, cited on their own copy", () => {
  // The office sheet has shown "Authorized by …, signed quote EST-1044" since the authorization
  // work landed. The CUSTOMER's copy never carried it — so the person who actually signed saw no
  // record of their own signature on the bill, and had nothing to check the amount against. That
  // is precisely the document a disputed invoice turns on.
  const SIGNED = {
    signerName: "Owen Duggan",
    signedAt: new Date("2026-08-11T17:04:00Z"),
    documentRef: "EST-1044",
    authorizedCents: 122_300,
  };

  it("carries the signature onto the customer's copy", () => {
    const view = toPublicInvoiceView(invoice(), ctx({ authorization: SIGNED }));

    expect(view.authorization).toMatchObject({
      signerName: "Owen Duggan",
      documentRef: "EST-1044",
      authorizedCents: 122_300,
    });
  });

  it("carries nothing when nothing was signed", () => {
    // An unsigned invoice has no authorised amount, so there is no claim to make about it —
    // the same reason the office banner stays rare enough to mean something.
    const view = toPublicInvoiceView(invoice(), ctx({ authorization: null }));

    expect(view.authorization).toBeNull();
  });
});
