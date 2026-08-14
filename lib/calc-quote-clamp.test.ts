/**
 * lib/calc-quote-clamp.test.ts
 *
 * calcQuote is the office's client-side money math for a quote (estimate modal, customer quote
 * modal, composer summary). The domain refuses a discount or deposit outside 0–10000 bps
 * (modules/quoting/domain/estimate.ts), so a percentage past 100 is a figure the server would
 * never agree to — and rendering it produced a quote that read "Total +$-41".
 *
 * The composer's Pricing inputs clamp at entry; this pins the same bound in the math, so a
 * percentage that arrives from anywhere else (a stored draft, a pasted state) still prints a
 * quote the customer could actually be charged.
 */
import { describe, it, expect } from "vitest";
import { calcQuote, type SampleEstimateLine } from "@/lib/prototype-sample";

const lines: SampleEstimateLine[] = [{ d: "Water heater swap", q: 1, r: 1000 }];

describe("calcQuote — percentage bounds", () => {
  it("holds the ordinary case unchanged", () => {
    const m = calcQuote(lines, { disc: 10, tax: 8, dep: 25 });
    expect(m.sub).toBe(1000);
    expect(m.disc).toBe(100);
    expect(m.taxed).toBeCloseTo(72, 5);
    expect(m.total).toBeCloseTo(972, 5);
    expect(m.dep).toBeCloseTo(243, 5);
  });

  it("caps a discount over 100% at the subtotal — never a negative total or tax", () => {
    const m = calcQuote(lines, { disc: 150, tax: 8, dep: 0 });
    expect(m.disc).toBe(1000);
    expect(m.taxed).toBe(0);
    expect(m.total).toBe(0);
  });

  it("caps a deposit over 100% at the total", () => {
    const m = calcQuote(lines, { disc: 0, tax: 0, dep: 150 });
    expect(m.dep).toBe(1000);
  });

  it("floors a negative percentage at zero", () => {
    const m = calcQuote(lines, { disc: -50, tax: 0, dep: -10 });
    expect(m.disc).toBe(0);
    expect(m.total).toBe(1000);
    expect(m.dep).toBe(0);
  });
});
