/**
 * A saved assembly's parts. What matters here is that a template stays a template — no
 * quantity, no evaluation — and that the signature answers one question honestly: is this
 * assembly the same as the one in the book, or has it drifted?
 */
import { describe, it, expect } from "vitest";
import {
  ItemComponent,
  componentSignature,
  MAX_COMPONENT_DESCRIPTION_CHARS,
  MAX_COMPONENT_UNIT_CHARS,
  MAX_COMPONENT_QTY_EXPR_LENGTH,
} from "./item-component";
import { MAX_QTY_EXPR_LENGTH } from "@mallet/quoting/domain/quantity-expression";

const base = (over: Partial<Parameters<typeof ItemComponent.create>[0]> = {}) => ({
  id: "c-1",
  description: "Line posts, 4×4×8 cedar",
  unit: "ea",
  qtyExpr: "qty/8+1",
  roundUp: true,
  unitCostCents: 1800,
  unitPriceCents: 2430,
  markupBps: 3500,
  position: 0,
  ...over,
});

const built = (over: Partial<Parameters<typeof ItemComponent.create>[0]> = {}) => {
  const r = ItemComponent.create(base(over));
  if (!r.ok) throw new Error(`expected a component, got ${r.error.message}`);
  return r.value;
};

const failure = (over: Partial<Parameters<typeof ItemComponent.create>[0]>) => {
  const r = ItemComponent.create(base(over));
  if (r.ok) throw new Error("expected a validation error");
  return r.error;
};

describe("ItemComponent", () => {
  it("keeps the expression a count is derived from, not a count", () => {
    const component = built().props;
    expect(component.qtyExpr).toBe("qty/8+1");
    expect(component.roundUp).toBe(true);
    expect("quantity" in component).toBe(false);
  });

  it("accepts an expression it cannot evaluate — a template has no driver yet", () => {
    // Refusing "qty/8+1" for want of a qty would reject every saved assembly there is. The
    // estimate line evaluates it against a real driver on the way in.
    expect(built({ qtyExpr: "qty*2+trim" }).props.qtyExpr).toBe("qty*2+trim");
  });

  it("normalizes a blank unit and a blank expression to null", () => {
    expect(built({ unit: "  ", qtyExpr: " " }).props.unit).toBeNull();
    expect(built({ unit: "  ", qtyExpr: " " }).props.qtyExpr).toBeNull();
  });

  it("refuses a component with nothing written on it", () => {
    expect(failure({ description: "   " }).field).toBe("description");
  });

  it("refuses text longer than the columns hold", () => {
    expect(failure({ description: "x".repeat(MAX_COMPONENT_DESCRIPTION_CHARS + 1) }).field).toBe("description");
    expect(failure({ unit: "x".repeat(MAX_COMPONENT_UNIT_CHARS + 1) }).field).toBe("unit");
    expect(failure({ qtyExpr: "1+".repeat(MAX_COMPONENT_QTY_EXPR_LENGTH) }).field).toBe("qtyExpr");
  });

  it("refuses negative money and a fractional markup", () => {
    expect(failure({ unitCostCents: -1 }).field).toBe("unitCostCents");
    expect(failure({ unitPriceCents: -1 }).field).toBe("unitPriceCents");
    expect(failure({ markupBps: 12.5 }).field).toBe("markupBps");
    expect(failure({ markupBps: -1 }).field).toBe("markupBps");
  });

  it("allows no markup at all — a typed price is not priced from cost", () => {
    expect(built({ markupBps: null }).props.markupBps).toBeNull();
  });

  it("pins its expression bound to the one quoting enforces on the column", () => {
    // Restated rather than imported (the module boundary forbids the deep import, and quoting's
    // barrel throws without DB env). This test is what keeps the two from drifting apart.
    expect(MAX_COMPONENT_QTY_EXPR_LENGTH).toBe(MAX_QTY_EXPR_LENGTH);
  });
});

describe("componentSignature", () => {
  it("says two assemblies are the same when the parts are the same", () => {
    expect(componentSignature([built()])).toBe(componentSignature([built({ id: "different" })]));
  });

  it("ignores the order they were handed over in, and reads position instead", () => {
    const posts = built({ id: "a", description: "Posts", position: 0 });
    const rails = built({ id: "b", description: "Rails", position: 1 });
    expect(componentSignature([posts, rails])).toBe(componentSignature([rails, posts]));
  });

  it("notices a price change", () => {
    expect(componentSignature([built()])).not.toBe(componentSignature([built({ unitPriceCents: 2500 })]));
  });

  it("notices a changed expression, which is the drift that costs money", () => {
    expect(componentSignature([built()])).not.toBe(componentSignature([built({ qtyExpr: "qty/6+1" })]));
  });

  it("notices a component that was added or removed", () => {
    const one = [built({ id: "a", position: 0 })];
    const two = [...one, built({ id: "b", description: "Rails", position: 1 })];
    expect(componentSignature(one)).not.toBe(componentSignature(two));
  });

  it("does not mutate the array it was given", () => {
    const input = [built({ id: "b", position: 1 }), built({ id: "a", position: 0 })];
    componentSignature(input);
    expect(input[0]?.props.position).toBe(1);
  });
});
