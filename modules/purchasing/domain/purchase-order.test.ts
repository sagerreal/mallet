import { describe, it, expect } from "vitest";
import { asOrgId, isOk, isErr } from "@mallet/shared/types";
import { PurchaseOrder, lineCents, totalCents } from "./purchase-order";

const ORG = asOrgId("22222222-2222-2222-2222-222222222222");
const base = {
  id: "11111111-1111-1111-1111-111111111111",
  orgId: ORG,
  num: null,
  vendor: "Ferguson",
  status: "draft" as const,
  jobId: null,
  orderedAt: null,
  expectedAt: null,
  shipTo: "counter_pickup" as const,
  orderedByUserId: null,
  freightCents: 0,
  taxCents: 0,
  lines: [],
  createdAt: new Date("2026-08-28T00:00:00Z"),
  updatedAt: new Date("2026-08-28T00:00:00Z"),
};

describe("PurchaseOrder.create", () => {
  it("needs a vendor — there is no such thing as an order with nobody to place it with", () => {
    const r = PurchaseOrder.create({ ...base, vendor: "  " });
    expect(isErr(r)).toBe(true);
  });

  it("accepts a stock order with no job", () => {
    const r = PurchaseOrder.create(base);
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value.props.jobId).toBeNull();
  });

  it("refuses a placed order with no number", () => {
    const r = PurchaseOrder.create({ ...base, status: "ordered", num: null });
    expect(isErr(r)).toBe(true);
  });

  it("refuses a draft that already carries a number", () => {
    const r = PurchaseOrder.create({ ...base, num: "PO-1000" });
    expect(isErr(r)).toBe(true);
  });

  it("refuses a negative freight or tax — money out is not a credit", () => {
    expect(isErr(PurchaseOrder.create({ ...base, freightCents: -1 }))).toBe(true);
    expect(isErr(PurchaseOrder.create({ ...base, taxCents: -1 }))).toBe(true);
  });
});

describe("money", () => {
  const line = { id: "l1", description: "3/4in PEX-A coil", qty: 4, uom: "coil", unitCostMillicents: 8_640_000, position: 0 };

  it("rounds a line to whole cents from millicents", () => {
    expect(lineCents(line)).toBe(34_560);
  });

  // $0.2145/ft is why unit cost is millicents: integer cents would price this at 21c and
  // under-report 500ft by $2.25.
  it("keeps sub-cent unit costs honest across a long run", () => {
    expect(lineCents({ ...line, qty: 500, uom: "ft", unitCostMillicents: 21_450 })).toBe(10_725);
  });

  it("adds freight and tax on top of the lines", () => {
    const r = PurchaseOrder.create({ ...base, lines: [line], freightCents: 4_200, taxCents: 6_890 });
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(totalCents(r.value)).toBe(34_560 + 4_200 + 6_890);
  });
});

describe("place / cancel", () => {
  it("placing stamps the number and the date, and is not reversible to draft", () => {
    // NOTE: the brief's fixture used bare `base` (zero lines) here, which contradicts the very
    // next test ("refuses to place an order with no lines") — both can't pass against a single
    // deterministic place() that requires at least one line (as the brief's own place()
    // implementation does, and as that next test confirms is the intended behavior). Adding a
    // line here, matching the pattern used by the other place()/cancel() tests below.
    const r = PurchaseOrder.create({
      ...base,
      lines: [{ id: "l1", description: "x", qty: 1, uom: "ea", unitCostMillicents: 100_000, position: 0 }],
    });
    if (!isOk(r)) throw new Error("seed invalid");
    const placed = r.value.place("PO-1000", new Date("2026-08-28T00:00:00Z"));
    expect(isOk(placed)).toBe(true);
    if (isOk(placed)) {
      expect(placed.value.props.status).toBe("ordered");
      expect(placed.value.props.num).toBe("PO-1000");
      // The original is untouched — the aggregate is immutable.
      expect(r.value.props.status).toBe("draft");
    }
  });

  it("refuses to place an order with no lines", () => {
    const r = PurchaseOrder.create(base);
    if (!isOk(r)) throw new Error("seed invalid");
    expect(isErr(r.value.place("PO-1000", new Date()))).toBe(true);
  });

  it("cancels a placed order and contributes nothing to job cost after", () => {
    const r = PurchaseOrder.create({ ...base, status: "ordered", num: "PO-1000", lines: [{ id: "l1", description: "x", qty: 1, uom: "ea", unitCostMillicents: 100_000, position: 0 }] });
    if (!isOk(r)) throw new Error("seed invalid");
    const c = r.value.cancel();
    expect(isOk(c)).toBe(true);
    if (isOk(c)) expect(c.value.jobCostCents()).toBe(0);
  });

  it("charges the job the whole order once placed — there is no receiving", () => {
    const r = PurchaseOrder.create({ ...base, status: "ordered", num: "PO-1000", freightCents: 500, lines: [{ id: "l1", description: "x", qty: 2, uom: "ea", unitCostMillicents: 100_000, position: 0 }] });
    if (!isOk(r)) throw new Error("seed invalid");
    expect(r.value.jobCostCents()).toBe(200 + 500);
  });

  it("charges nothing for a draft", () => {
    const r = PurchaseOrder.create({ ...base, lines: [{ id: "l1", description: "x", qty: 1, uom: "ea", unitCostMillicents: 100_000, position: 0 }] });
    if (!isOk(r)) throw new Error("seed invalid");
    expect(r.value.jobCostCents()).toBe(0);
  });

  // Pins the domain to purchase_orders_num_check: (status = 'draft') = (num is null). A draft
  // has no number, and a cancelled order must still carry one — so a draft can never become
  // cancelled; it must be deleted instead.
  it("refuses to cancel a draft — delete it instead, the vendor never heard of it", () => {
    const r = PurchaseOrder.create(base);
    if (!isOk(r)) throw new Error("seed invalid");
    expect(isErr(r.value.cancel())).toBe(true);
  });
});
