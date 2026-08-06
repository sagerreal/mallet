import { describe, it, expect } from "vitest";
import {
  asInvoiceId,
  asOrgId,
  asLeadId,
  money,
  zeroMoney,
  isOk,
} from "@mallet/shared/types";
import { Invoice, type InvoiceProps, type InvoiceStatus } from "./invoice";
import { Payment } from "./payment";
import { InvoiceLine } from "./invoice-line";

const props = (overrides: Partial<InvoiceProps> = {}): InvoiceProps => ({
  id: asInvoiceId("11111111-1111-1111-1111-111111111111"),
  orgId: asOrgId("22222222-2222-2222-2222-222222222222"),
  num: "INV-1000",
  taxBps: 0,
  discBps: 0,
  discount: zeroMoney,
  tax: zeroMoney,
  sourceJobId: null,
  scopeJobId: null,
  leadId: asLeadId("33333333-3333-3333-3333-333333333333"),
  title: "Deck rebuild",
  status: "draft",
  total: money(100_000),
  depositPaid: zeroMoney,
  amountPaid: zeroMoney,
  payments: [],
  lines: [],
  termsDays: 7,
  sentAt: null,
  dueAt: null,
  poNumber: null,
  publicToken: null,
  createdAt: new Date("2026-06-01T00:00:00Z"),
  updatedAt: new Date("2026-06-01T00:00:00Z"),
  ...overrides,
});

const make = (overrides: Partial<InvoiceProps> = {}): Invoice => {
  const r = Invoice.create(props(overrides));
  if (!isOk(r)) throw new Error(r.error.message);
  return r.value;
};

const payment = (cents: number, key = "idem-key-123"): Payment => {
  const r = Payment.create({
    id: "p1",
    amount: money(cents),
    method: "cash",
    idempotencyKey: key,
    externalId: null,
    recordedByUserId: null,
    receivedAt: new Date("2026-06-05T00:00:00Z"),
  });
  if (!isOk(r)) throw new Error(r.error.message);
  return r.value;
};

const now = new Date("2026-06-10T00:00:00Z");

describe("Invoice.create", () => {
  it("rejects negative total, deposit>total, negative amountPaid, unknown status", () => {
    expect(Invoice.create(props({ total: money(-1) })).ok).toBe(false);
    expect(Invoice.create(props({ depositPaid: money(200_000) })).ok).toBe(false);
    expect(Invoice.create(props({ amountPaid: money(-1) })).ok).toBe(false);
    expect(Invoice.create(props({ status: "bogus" as never })).ok).toBe(false);
  });
});

describe("Invoice.due", () => {
  it("derives total - deposit - amountPaid, clamped at zero", () => {
    expect(make({ total: money(100_000), depositPaid: money(20_000), amountPaid: money(30_000) }).due()).toBe(
      50_000,
    );
    expect(make({ total: money(100_000), amountPaid: money(150_000) }).due()).toBe(0); // overpay clamps
  });
});

describe("Invoice.send", () => {
  it("stamps dueAt = sentAt + termsDays and is idempotent", () => {
    const sent = make({ termsDays: 7 }).send(now);
    expect(isOk(sent) && sent.value.props.status).toBe("sent");
    if (isOk(sent)) {
      expect(sent.value.props.dueAt?.toISOString()).toBe("2026-06-17T00:00:00.000Z");
      const again = sent.value.send(new Date("2026-06-11T00:00:00Z"));
      expect(isOk(again) && again.value).toBe(sent.value);
    }
  });
});

describe("Invoice.recordPayment", () => {
  it("flips sent -> partial -> paid at a zero balance", () => {
    const sent = make({ total: money(100_000) }).send(now);
    if (!isOk(sent)) throw new Error("send failed");
    const partial = sent.value.recordPayment(payment(40_000, "key-aaaaaa1"), now);
    expect(isOk(partial) && partial.value.props.status).toBe("partial");
    if (!isOk(partial)) throw new Error("partial failed");
    const paid = partial.value.recordPayment(payment(60_000, "key-bbbbbb2"), now);
    expect(isOk(paid) && paid.value.props.status).toBe("paid");
    if (isOk(paid)) expect(paid.value.due()).toBe(0);
  });

  it("rejects a payment on a void invoice", () => {
    const voided = make().void(now);
    if (!isOk(voided)) throw new Error("void failed");
    expect(voided.value.recordPayment(payment(1_000), now).ok).toBe(false);
  });
});

describe("Invoice.void", () => {
  it("voids a non-paid invoice but not a paid one", () => {
    expect(make({ status: "sent" }).void(now).ok).toBe(true);
    const paid = make({ total: money(1_000), status: "paid", amountPaid: money(1_000) });
    expect(paid.void(now).ok).toBe(false);
  });

  it("voids a DRAFT (archiving a draft moves it to void — the store relies on this)", () => {
    const voided = make({ status: "draft" }).void(now);
    expect(isOk(voided)).toBe(true);
    if (isOk(voided)) expect(voided.value.props.status).toBe("void");
  });
});

describe("Invoice.isOverdue", () => {
  it("is true only for sent/partial past the due date", () => {
    const sent = make({ status: "sent", dueAt: new Date("2026-06-05T00:00:00Z") });
    expect(sent.isOverdue(now)).toBe(true);
    const draft = make({ status: "draft", dueAt: new Date("2026-06-05T00:00:00Z") });
    expect(draft.isOverdue(now)).toBe(false);
    const notYetDue = make({ status: "sent", dueAt: new Date("2026-06-20T00:00:00Z") });
    expect(notYetDue.isOverdue(now)).toBe(false);
  });
});

describe("Invoice.editMetadata", () => {
  const build = (status: InvoiceStatus, overrides: Partial<InvoiceProps> = {}) => {
    const r = Invoice.create({
      id: asInvoiceId("11111111-1111-1111-1111-111111111111"),
      orgId: asOrgId("22222222-2222-2222-2222-222222222222"),
      num: "INV-900",
      sourceJobId: null,
      leadId: asLeadId("33333333-3333-3333-3333-333333333333"),
      title: "Old title",
      status,
      total: money(100_000),
      depositPaid: money(0),
      amountPaid: money(0),
      payments: [],
      lines: [],
      termsDays: 7,
      sentAt: status === "draft" ? null : new Date("2026-07-01T00:00:00Z"),
      dueAt: null,
      createdAt: new Date("2026-07-01T00:00:00Z"),
      updatedAt: new Date("2026-07-01T00:00:00Z"),
      ...overrides,
    });
    if (!r.ok) throw new Error(r.error.message);
    return r.value;
  };
  const now = new Date("2026-07-10T12:00:00Z");

  it("patches leadId/title/termsDays/depositPaid on a draft", () => {
    const res = build("draft").editMetadata(
      {
        leadId: asLeadId("44444444-4444-4444-4444-444444444444"),
        title: "New title",
        termsDays: 30,
        depositPaid: money(25_000),
      },
      now,
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.props.leadId).toBe("44444444-4444-4444-4444-444444444444");
      expect(res.value.props.title).toBe("New title");
      expect(res.value.props.termsDays).toBe(30);
      expect(res.value.props.depositPaid).toBe(25_000);
      expect(res.value.props.updatedAt.toISOString()).toBe(now.toISOString());
    }
  });

  it("allows editing a SENT invoice's metadata", () => {
    const res = build("sent").editMetadata({ termsDays: 14 }, now);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.props.termsDays).toBe(14);
  });

  it("keeps fields that are undefined in the patch", () => {
    const res = build("draft", { title: "Keep me" }).editMetadata({ termsDays: 21 }, now);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.props.title).toBe("Keep me");
      expect(res.value.props.leadId).toBe("33333333-3333-3333-3333-333333333333");
    }
  });

  it("clears title to null", () => {
    const res = build("draft").editMetadata({ title: null }, now);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.props.title).toBeNull();
  });

  it("rejects editing a PAID invoice", () => {
    const res = build("paid").editMetadata({ termsDays: 30 }, now);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.field).toBe("status");
  });

  it("rejects editing a VOID invoice", () => {
    const res = build("void").editMetadata({ termsDays: 30 }, now);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.field).toBe("status");
  });

  it("rejects a negative termsDays", () => {
    const res = build("draft").editMetadata({ termsDays: -1 }, now);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.field).toBe("termsDays");
  });

  it("rejects a depositPaid greater than total (create invariant)", () => {
    const res = build("draft").editMetadata({ depositPaid: money(200_000) }, now);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.field).toBe("depositPaid");
  });

  it("sets a poNumber", () => {
    const res = build("draft").editMetadata({ poNumber: "4471" }, now);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.props.poNumber).toBe("4471");
  });

  it("trims a poNumber", () => {
    const res = build("draft").editMetadata({ poNumber: "  4471  " }, now);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.props.poNumber).toBe("4471");
  });

  it("trims a blank/whitespace-only poNumber to null (clears it)", () => {
    const res = build("draft", { poNumber: "old-po" }).editMetadata({ poNumber: "   " }, now);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.props.poNumber).toBeNull();
  });

  it("clears a poNumber with explicit null", () => {
    const res = build("draft", { poNumber: "old-po" }).editMetadata({ poNumber: null }, now);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.props.poNumber).toBeNull();
  });

  it("keeps the poNumber when undefined in the patch", () => {
    const res = build("draft", { poNumber: "keep-me" }).editMetadata({ termsDays: 14 }, now);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.props.poNumber).toBe("keep-me");
  });

  it("allows setting a poNumber on a SENT invoice (not frozen until paid/void)", () => {
    const res = build("sent").editMetadata({ poNumber: "4471" }, now);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.props.poNumber).toBe("4471");
  });

  it("rejects a poNumber over 64 characters", () => {
    const res = build("draft").editMetadata({ poNumber: "x".repeat(65) }, now);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.field).toBe("poNumber");
  });

  it("accepts a poNumber at exactly 64 characters", () => {
    const res = build("draft").editMetadata({ poNumber: "x".repeat(64) }, now);
    expect(res.ok).toBe(true);
  });
});

describe("Invoice.editLines", () => {
  const line = (rateCents: number, qty: number, pos: number): InvoiceLine => {
    const r = InvoiceLine.create({
      id: `00000000-0000-0000-0000-${String(pos + 1).padStart(12, "0")}`,
      sourceJobLineId: null,
      description: "Work",
      quantity: qty,
      rate: money(rateCents),
      cost: money(0),
      position: pos,
    });
    if (!r.ok) throw new Error(r.error.message);
    return r.value;
  };
  const build = (status: InvoiceStatus) => {
    const r = Invoice.create({
      id: asInvoiceId("11111111-1111-1111-1111-111111111111"),
      orgId: asOrgId("22222222-2222-2222-2222-222222222222"),
      num: "INV-901",
      sourceJobId: null,
      leadId: asLeadId("33333333-3333-3333-3333-333333333333"),
      title: "T",
      status,
      total: money(100_000),
      depositPaid: money(0),
      amountPaid: money(0),
      payments: [],
      lines: [],
      termsDays: 7,
      sentAt: status === "draft" ? null : new Date("2026-07-01T00:00:00Z"),
      dueAt: null,
      createdAt: new Date("2026-07-01T00:00:00Z"),
      updatedAt: new Date("2026-07-01T00:00:00Z"),
    });
    if (!r.ok) throw new Error(r.error.message);
    return r.value;
  };
  const now = new Date("2026-07-10T12:00:00Z");

  it("replaces lines and recomputes the total on a draft", () => {
    const res = build("draft").editLines([line(20_000, 2, 0), line(5_000, 1, 1)], now);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.props.lines).toHaveLength(2);
      expect(res.value.props.total).toBe(45_000); // 2*20000 + 1*5000
      expect(res.value.props.updatedAt.toISOString()).toBe(now.toISOString());
    }
  });

  it("recomputes the total when editing a SENT invoice", () => {
    const res = build("sent").editLines([line(30_000, 1, 0)], now);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.props.total).toBe(30_000);
  });

  it("allows clearing to zero lines (total = 0)", () => {
    const res = build("draft").editLines([], now);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.props.lines).toHaveLength(0);
      expect(res.value.props.total).toBe(0);
    }
  });

  it("rejects editing lines on a PAID invoice", () => {
    const res = build("paid").editLines([line(1_000, 1, 0)], now);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.field).toBe("status");
  });

  it("rejects editing lines on a VOID invoice", () => {
    const res = build("void").editLines([line(1_000, 1, 0)], now);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.field).toBe("status");
  });

  it("rejects when the new total falls below an already-collected deposit", () => {
    // A sent invoice with a $500 deposit collected against a $1000 total.
    const r = Invoice.create({
      id: asInvoiceId("11111111-1111-1111-1111-111111111111"),
      orgId: asOrgId("22222222-2222-2222-2222-222222222222"),
      num: "INV-902",
      sourceJobId: null,
      leadId: asLeadId("33333333-3333-3333-3333-333333333333"),
      title: "T",
      status: "sent",
      total: money(100_000),
      depositPaid: money(50_000),
      amountPaid: money(0),
      payments: [],
      lines: [],
      termsDays: 7,
      sentAt: new Date("2026-07-01T00:00:00Z"),
      dueAt: null,
      createdAt: new Date("2026-07-01T00:00:00Z"),
      updatedAt: new Date("2026-07-01T00:00:00Z"),
    });
    if (!r.ok) throw new Error(r.error.message);
    // Shrinking the total to 20_000 < the 50_000 deposit must fail the invariant.
    const res = r.value.editLines([line(20_000, 1, 0)], now);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.field).toBe("depositPaid");
  });
});

describe("Invoice — the tax split", () => {
  /**
   * The invariant the whole design rests on. `total` is TAX-INCLUSIVE, carried from the estimate's
   * rounding chain (total = net + tax). Treating it as a pre-tax subtotal and adding tax on top
   * would change the balance due — total − deposit − amountPaid — on every invoice that already
   * exists, so a caller who does must fail here rather than in somebody's books.
   */
  it("refuses a tax larger than the total it is supposed to be part of", () => {
    const r = Invoice.create(props({ total: money(10_000), tax: money(10_001) }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("tax");
  });

  it("allows a tax equal to the total, which a fully-taxable zero-net invoice would be", () => {
    expect(Invoice.create(props({ total: money(10_000), tax: money(10_000) })).ok).toBe(true);
  });

  it("refuses a negative tax", () => {
    expect(Invoice.create(props({ total: money(10_000), tax: money(-1) })).ok).toBe(false);
  });

  it("refuses a negative rate", () => {
    const r = Invoice.create(props({ taxBps: -1 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("taxBps");
  });

  // Most invoices are drafted by hand and no tax was ever computed for them, which is not the
  // same as a computed split that happens to be zero.
  it("defaults to no split when none was computed", () => {
    const r = Invoice.create(props());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.props.taxBps).toBe(0);
      expect(r.value.props.tax).toBe(0);
    }
  });

  it("keeps the split through a send, which must not touch the money", () => {
    const made = Invoice.create(props({ total: money(10_000), taxBps: 875, tax: money(804) }));
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    const sent = made.value.send(new Date("2026-07-25T12:00:00Z"));
    expect(sent.ok).toBe(true);
    if (sent.ok) {
      expect(sent.value.props.tax).toBe(804);
      expect(sent.value.props.total).toBe(10_000);
    }
  });
});
