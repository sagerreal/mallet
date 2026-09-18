import { describe, it, expect } from "vitest";
import { evaluateQuantityExpression, resolveLineQuantity, DRIVER_TOKEN } from "./quantity-expression";

const ok = (expr: string, driver?: number, unitAlias?: string) => {
  const r = evaluateQuantityExpression(expr, driver, unitAlias);
  if (!r.ok) throw new Error(`expected ok, got ${r.error.message}`);
  return r.value;
};

const errOf = (expr: string, driver?: number) => {
  const r = evaluateQuantityExpression(expr, driver);
  if (r.ok) throw new Error(`expected an error, got ${r.value}`);
  return r.error;
};

describe("evaluateQuantityExpression", () => {
  it("reads a plain number", () => {
    expect(ok("4")).toBe(4);
    expect(ok("12.5")).toBe(12.5);
    expect(ok(" 7 ")).toBe(7);
  });

  it("accepts a number typed with thousands separators", () => {
    // Estimators type "2,000" — that is a number, not an expression.
    expect(ok("2,000")).toBe(2000);
    expect(ok("1,250.5")).toBe(1250.5);
  });

  it("does the four operations with precedence and parentheses", () => {
    expect(ok("2+3*4")).toBe(14);
    expect(ok("(2+3)*4")).toBe(20);
    expect(ok("10/4")).toBe(2.5);
    expect(ok("10-2-3")).toBe(5);
    expect(ok("-3+10")).toBe(7);
  });

  it("binds the driver quantity to the qty token", () => {
    expect(ok(`${DRIVER_TOKEN}/8+1`, 100)).toBe(13.5);
    expect(ok("qty*6.5", 100)).toBe(650);
    expect(ok("(qty/8+1)*2", 100)).toBe(27);
  });

  it("accepts the unit name as an alias for the driver", () => {
    // A shop that typed "LF/8" before renaming its unit must keep working.
    expect(ok("LF/8+1", 100, "LF")).toBe(13.5);
    expect(ok("lf/8+1", 100, "LF")).toBe(13.5);
    expect(ok("run/4", 100)).toBe(25);
  });

  it("supports the advanced rounding helpers", () => {
    expect(ok("ceil(qty/8)", 100)).toBe(13);
    expect(ok("floor(qty/8)", 100)).toBe(12);
    expect(ok("round(qty/8)", 100)).toBe(13);
    expect(ok("max(2,qty/100)", 100)).toBe(2);
    expect(ok("min(2,qty/100)", 100)).toBe(1);
  });

  it("treats an absent driver as zero rather than failing", () => {
    // A line on a quote with no driver still resolves; it just resolves to nothing.
    expect(ok("qty*2")).toBe(0);
  });

  it("rejects an empty expression", () => {
    expect(errOf("").field).toBe("qtyExpr");
    expect(errOf("   ").field).toBe("qtyExpr");
  });

  it("rejects an unfinished or malformed expression", () => {
    expect(errOf("qty/").message).toMatch(/check the math/i);
    expect(errOf("((qty)").message).toMatch(/check the math/i);
    expect(errOf("2 3").message).toMatch(/check the math/i);
  });

  it("rejects an unknown name", () => {
    expect(errOf("width*2", 100).message).toMatch(/check the math/i);
  });

  it("rejects anything that is not finite", () => {
    // Division by zero is the one that reaches a real quote: "qty/0".
    expect(errOf("qty/0", 100).message).toMatch(/check the math/i);
  });

  it("refuses characters that are not part of the grammar", () => {
    // The expression is stored and re-evaluated server-side; the grammar is the guard.
    expect(errOf("qty; drop table").message).toMatch(/check the math/i);
    expect(errOf("qty**2", 100).message).toMatch(/check the math/i);
  });

  it("refuses an expression longer than the column allows", () => {
    expect(errOf(`1+${"1+".repeat(200)}1`).message).toMatch(/too long/i);
  });
});

describe("resolveLineQuantity", () => {
  it("returns the typed quantity when there is no expression", () => {
    expect(resolveLineQuantity({ quantity: 4 })).toEqual({ ok: true, value: 4 });
  });

  it("resolves an expression against the driver", () => {
    expect(resolveLineQuantity({ quantity: 0, qtyExpr: "qty/8+1", driver: 100 })).toEqual({
      ok: true,
      value: 13.5,
    });
  });

  it("rounds up only when the line says to", () => {
    expect(resolveLineQuantity({ quantity: 0, qtyExpr: "qty/8+1", driver: 100, roundUp: true })).toEqual({
      ok: true,
      value: 14,
    });
    expect(resolveLineQuantity({ quantity: 13.5, roundUp: true })).toEqual({ ok: true, value: 14 });
  });

  it("rounds the resolved quantity to the two decimals the column stores", () => {
    // quantity is numeric(12,2) — an unrounded 1/3 would be rejected by the line VO.
    expect(resolveLineQuantity({ quantity: 0, qtyExpr: "qty/3", driver: 100 })).toEqual({
      ok: true,
      value: 33.33,
    });
  });

  it("fails the line rather than silently substituting a quantity", () => {
    const result = resolveLineQuantity({ quantity: 0, qtyExpr: "qty/0", driver: 100 });
    expect(result.ok).toBe(false);
  });
});
