import { describe, it, expect } from "vitest";
import { money, isOk } from "@mallet/shared/types";
import { InvoiceLine, type InvoiceLineProps } from "./invoice-line";

const props = (overrides: Partial<InvoiceLineProps> = {}): InvoiceLineProps => ({
  id: "line-1",
  sourceJobLineId: null,
  description: "Labour",
  quantity: 2,
  rate: money(5000),
  cost: money(3000),
  taxable: true,
  position: 0,
  ...overrides,
});

const make = (overrides: Partial<InvoiceLineProps> = {}): InvoiceLine => {
  const r = InvoiceLine.create(props(overrides));
  if (!isOk(r)) throw new Error(r.error.message);
  return r.value;
};

describe("InvoiceLine.create – happy path", () => {
  it("succeeds with valid props and exposes them via .props", () => {
    const line = make();
    expect(line.props.description).toBe("Labour");
    expect(line.props.quantity).toBe(2);
    expect(line.props.rate).toBe(money(5000));
    expect(line.props.cost).toBe(money(3000));
    expect(line.props.position).toBe(0);
  });

  it("trims leading/trailing whitespace from description", () => {
    const line = make({ description: "  Trim me  " });
    expect(line.props.description).toBe("Trim me");
  });

  it("accepts a quantity with exactly 2 decimal places", () => {
    const r = InvoiceLine.create(props({ quantity: 1.25 }));
    expect(r.ok).toBe(true);
  });

  it("accepts zero quantity", () => {
    const r = InvoiceLine.create(props({ quantity: 0 }));
    expect(r.ok).toBe(true);
  });

  it("accepts zero rate", () => {
    const r = InvoiceLine.create(props({ rate: money(0) }));
    expect(r.ok).toBe(true);
  });

  it("accepts zero cost", () => {
    const r = InvoiceLine.create(props({ cost: money(0) }));
    expect(r.ok).toBe(true);
  });
});

describe("InvoiceLine.create – validation rejections", () => {
  it("rejects an empty description", () => {
    const r = InvoiceLine.create(props({ description: "   " }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("description");
  });

  it("rejects a negative quantity", () => {
    const r = InvoiceLine.create(props({ quantity: -1 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("quantity");
  });

  it("rejects quantity with more than 2 decimal places (3dp)", () => {
    const r = InvoiceLine.create(props({ quantity: 1.001 }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.field).toBe("quantity");
      expect(r.error.message).toMatch(/2 decimal/);
    }
  });

  it("rejects quantity with more than 2 decimal places (fine fraction)", () => {
    // 0.333... has infinite precision — definitely >2dp
    const r = InvoiceLine.create(props({ quantity: 1 / 3 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("quantity");
  });

  it("rejects a negative rate", () => {
    const r = InvoiceLine.create(props({ rate: money(-1) }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.field).toBe("rate");
      expect(r.error.message).toMatch(/rate/);
    }
  });

  it("rejects a negative cost", () => {
    const r = InvoiceLine.create(props({ cost: money(-1) }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.field).toBe("cost");
      expect(r.error.message).toMatch(/cost/);
    }
  });
});

describe("InvoiceLine.amount()", () => {
  it("returns quantity * rate rounded to nearest cent", () => {
    // 2 units at 5000 cents = 10000 cents
    const line = make({ quantity: 2, rate: money(5000) });
    expect(line.amount()).toBe(money(10000));
  });

  it("rounds fractional cent results to the nearest integer", () => {
    // 1.5 units at 3 cents = 4.5 → rounds to 5
    const line = make({ quantity: 1.5, rate: money(3) });
    expect(line.amount()).toBe(money(5));
  });

  it("returns zero when quantity is zero", () => {
    const line = make({ quantity: 0, rate: money(5000) });
    expect(line.amount()).toBe(money(0));
  });

  it("returns zero when rate is zero", () => {
    const line = make({ quantity: 3, rate: money(0) });
    expect(line.amount()).toBe(money(0));
  });
});
