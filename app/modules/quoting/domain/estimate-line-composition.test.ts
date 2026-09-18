/**
 * The line fields the v4 composer redesign adds: a unit, typed quantity math, a parent for
 * assembly components, a section, per-line customer visibility, and a markup.
 *
 * These are validated HERE rather than only at the router because the domain is what the
 * repository writes: a line whose stored quantity disagrees with its own expression, or whose
 * markup is negative, must be impossible to construct at all.
 */
import { describe, it, expect } from "vitest";
import { EstimateLine, type EstimateLineCreateProps } from "./estimate";
import { money } from "@mallet/shared/types";
import type { EstimateLineId } from "@mallet/shared/types";

const base = (over: Partial<EstimateLineCreateProps> = {}): EstimateLineCreateProps => ({
  id: "11111111-1111-4111-8111-111111111111" as EstimateLineId,
  description: "Line posts, 4×4×8 cedar",
  quantity: 14,
  rate: money(2430),
  cost: money(1800),
  isOptional: false,
  needsPhoto: false,
  position: 0,
  tier: null,
  materialId: null,
  ...over,
});

const built = (over: Partial<EstimateLineCreateProps> = {}) => {
  const r = EstimateLine.create(base(over));
  if (!r.ok) throw new Error(`expected a line, got ${r.error.message}`);
  return r.value;
};

const failure = (over: Partial<EstimateLineCreateProps>) => {
  const r = EstimateLine.create(base(over));
  if (r.ok) throw new Error("expected a validation error");
  return r.error;
};

describe("EstimateLine — unit", () => {
  it("keeps the unit the quantity is counted in", () => {
    expect(built({ unit: "LF" }).props.unit).toBe("LF");
  });

  it("normalizes a blank unit to null so absent and empty mean one thing", () => {
    expect(built({ unit: "   " }).props.unit).toBeNull();
    expect(built({}).props.unit).toBeNull();
  });

  it("refuses a unit longer than the column allows", () => {
    expect(failure({ unit: "x".repeat(21) }).field).toBe("unit");
  });
});

describe("EstimateLine — typed quantity math", () => {
  it("keeps the expression beside the quantity it produced", () => {
    const line = built({ quantity: 14, qtyExpr: "qty/8+1", roundUp: true, driverQuantity: 100 });
    expect(line.props.qtyExpr).toBe("qty/8+1");
    expect(line.props.roundUp).toBe(true);
    expect(line.props.quantity).toBe(14);
  });

  it("defaults to no expression and no rounding", () => {
    const line = built({});
    expect(line.props.qtyExpr).toBeNull();
    expect(line.props.roundUp).toBe(false);
  });

  it("refuses an expression that does not produce the stored quantity", () => {
    // The whole point of storing both: they can never disagree.
    const error = failure({ quantity: 99, qtyExpr: "qty/8+1", driverQuantity: 100, roundUp: true });
    expect(error.field).toBe("quantity");
    expect(error.message).toMatch(/does not match/i);
  });

  it("accepts an expression that does produce the stored quantity", () => {
    expect(built({ quantity: 14, qtyExpr: "qty/8+1", driverQuantity: 100, roundUp: true }).props.quantity).toBe(14);
  });

  it("refuses an expression that cannot be evaluated", () => {
    expect(failure({ qtyExpr: "qty/", driverQuantity: 100 }).field).toBe("qtyExpr");
  });

  it("normalizes a blank expression to null", () => {
    expect(built({ qtyExpr: "  " }).props.qtyExpr).toBeNull();
  });
});

describe("EstimateLine — composition and visibility", () => {
  it("carries the parent it is a component of", () => {
    const parent = "22222222-2222-4222-8222-222222222222" as EstimateLineId;
    expect(built({ parentLineId: parent }).props.parentLineId).toBe(parent);
    expect(built({}).props.parentLineId).toBeNull();
  });

  it("refuses to be its own parent", () => {
    const id = "11111111-1111-4111-8111-111111111111" as EstimateLineId;
    expect(failure({ id, parentLineId: id }).field).toBe("parentLineId");
  });

  it("carries the section it sits under", () => {
    expect(built({ sectionId: "33333333-3333-4333-8333-333333333333" }).props.sectionId).toBe(
      "33333333-3333-4333-8333-333333333333",
    );
    expect(built({}).props.sectionId).toBeNull();
  });

  it("is shown to the customer unless told otherwise", () => {
    expect(built({}).props.customerVisible).toBe(true);
    expect(built({ customerVisible: false }).props.customerVisible).toBe(false);
  });
});

describe("EstimateLine — markup", () => {
  it("keeps the markup when the line is priced from its cost", () => {
    expect(built({ markupBps: 3500 }).props.markupBps).toBe(3500);
    expect(built({}).props.markupBps).toBeNull();
  });

  it("refuses a negative markup", () => {
    expect(failure({ markupBps: -1 }).field).toBe("markupBps");
  });

  it("refuses a fractional markup — basis points are whole", () => {
    expect(failure({ markupBps: 12.5 }).field).toBe("markupBps");
  });
});

describe("EstimateLine — the money math is unchanged", () => {
  it("still extends quantity by rate regardless of how the quantity was authored", () => {
    expect(built({ quantity: 14, rate: money(2430), qtyExpr: "qty/8+1", driverQuantity: 100, roundUp: true }).amount()).toBe(34020);
  });

  it("keeps composition through withoutTier", () => {
    const line = built({ tier: "good", unit: "LF", parentLineId: "22222222-2222-4222-8222-222222222222" as EstimateLineId });
    const resolved = line.withoutTier();
    expect(resolved.props.tier).toBeNull();
    expect(resolved.props.unit).toBe("LF");
    expect(resolved.props.parentLineId).toBe("22222222-2222-4222-8222-222222222222");
  });
});
