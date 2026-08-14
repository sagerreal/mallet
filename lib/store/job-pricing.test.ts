import { describe, it, expect } from "vitest";
import { jobPricingRates, jobPricedTotals, jobHasPricing } from "./job-pricing";

// $100 of sold work — the shape every surface in this suite reasons about.
const lines = [{ d: "Drain clear", q: 1, r: 100 }];

describe("jobPricingRates — stored percent pair → basis points", () => {
  it("maps percent to bps (8.45% → 845)", () => {
    expect(jobPricingRates({ pricing: { disc: 10, tax: 8.45 } })).toEqual({
      discBps: 1000,
      taxBps: 845,
      depBps: 0,
    });
  });

  it("absent pricing is zero rates — the common job carries none", () => {
    expect(jobPricingRates({})).toEqual({ discBps: 0, taxBps: 0, depBps: 0 });
  });

  it("clamps garbage: negative and non-finite percents read as 0", () => {
    expect(jobPricingRates({ pricing: { disc: -5, tax: Number.NaN } })).toEqual({
      discBps: 0,
      taxBps: 0,
      depBps: 0,
    });
  });
});

describe("jobPricedTotals — the SAME chain the server bills (deriveTotals)", () => {
  it("$100 at 8.45% tax totals $108.45 — never the raw line sum", () => {
    const t = jobPricedTotals({ lines, pricing: { disc: 0, tax: 8.45 } });
    expect(t.subtotal).toBe(10_000);
    expect(t.tax).toBe(845);
    expect(t.total).toBe(10_845);
  });

  it("the discount comes off before tax (discount → net → tax → total)", () => {
    const t = jobPricedTotals({ lines, pricing: { disc: 10, tax: 8.45 } });
    expect(t.discount).toBe(1_000);
    expect(t.net).toBe(9_000);
    expect(t.tax).toBe(761); // round(9000 × 845 / 10000)
    expect(t.total).toBe(9_761);
  });

  it("no stored pricing → the total IS the line sum", () => {
    const t = jobPricedTotals({ lines });
    expect(t.total).toBe(10_000);
    expect(t.tax).toBe(0);
    expect(t.discount).toBe(0);
  });

  it("extends quantities at cent precision, per line (matches the setLines wire)", () => {
    const t = jobPricedTotals({ lines: [{ d: "Valve", q: 2, r: 49.99 }] });
    expect(t.subtotal).toBe(9_998); // 2 × round(49.99 × 100)
  });

  it("a redacted rate (r null) contributes nothing — callers gate rendering on pricesHidden", () => {
    const t = jobPricedTotals({
      lines: [{ d: "Hidden", q: 1, r: null }],
      pricing: { disc: 0, tax: 8.45 },
    });
    expect(t.total).toBe(0);
  });
});

describe("jobHasPricing — drives whether a breakdown replaces the plain total", () => {
  it("true once either rate is set", () => {
    expect(jobHasPricing({ pricing: { disc: 5, tax: 0 } })).toBe(true);
    expect(jobHasPricing({ pricing: { disc: 0, tax: 8.45 } })).toBe(true);
  });

  it("false with no pricing or both rates zero", () => {
    expect(jobHasPricing({})).toBe(false);
    expect(jobHasPricing({ pricing: { disc: 0, tax: 0 } })).toBe(false);
  });
});

/**
 * A FRACTIONAL QUANTITY CRASHED THE WHOLE SHEET.
 *
 * `jobLineSubtotalCents` rounded the RATE to integer cents and then multiplied by the quantity,
 * so 1.5 hours of labour at an odd cent rate produced fractional cents — and `money()` throws on
 * a non-integer by contract. The throw is not caught anywhere on this path: opening the job took
 * the entire page to the error boundary ("Something went wrong"), reproduced on production as
 * `Money must be integer cents, got 241495.5`.
 *
 * Half-hours and half-units are ordinary in the trades, so this was reachable by typing a normal
 * number into a normal field.
 *
 * The server has always extended first and rounded second — `invoice-line.ts` does
 * `money(Math.round(quantity * rate))` — and the client's own price builder already agreed
 * (`Math.round(r * q * 100)`). This file was the one place that inverted the order.
 */
describe("fractional quantities", () => {
  it("does not throw on a half-hour line at an odd cent rate", () => {
    // 1.5 × $1,609.97 = 241,495.5 cents if you round the rate first. The exact production crash.
    expect(() => jobPricedTotals({ lines: [{ id: "l", d: "Labour", q: 1.5, r: 1609.97, c: 0 }] as never }))
      .not.toThrow();
  });

  it("extends THEN rounds, matching the server's invoice-line math", () => {
    const t = jobPricedTotals({ lines: [{ id: "l", d: "Labour", q: 1.5, r: 1609.97, c: 0 }] as never });
    // 1.5 * 160997 = 241495.5 → 241496, never 241495.5 and never 1.5 * 160997 truncated.
    expect(t.subtotal).toBe(Math.round(1.5 * 1609.97 * 100));
  });

  it("still totals whole quantities exactly as before", () => {
    const t = jobPricedTotals({ lines: [{ id: "l", d: "Part", q: 3, r: 12.34, c: 0 }] as never });
    expect(t.subtotal).toBe(3702);
  });

  it("survives a line whose quantity and rate are both fractional", () => {
    expect(() => jobPricedTotals({ lines: [{ id: "l", d: "Pipe", q: 2.75, r: 3.33, c: 0 }] as never }))
      .not.toThrow();
  });
});
