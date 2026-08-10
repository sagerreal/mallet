import { describe, it, expect } from "vitest";
import { money } from "./money";
import { deriveTotals, ZERO_RATES, BPS_DENOMINATOR } from "./pricing-chain";

const m = (cents: number) => money(cents);

describe("deriveTotals", () => {
  it("passes the subtotal straight through when nothing is set", () => {
    const t = deriveTotals(m(50_000), m(50_000), ZERO_RATES);
    expect(t).toEqual({
      subtotal: 50_000,
      discount: 0,
      net: 50_000,
      tax: 0,
      total: 50_000,
      depositDue: 0,
    });
  });

  it("applies the discount to the subtotal, rounded to whole cents", () => {
    // 10% of $114.98 = $11.498 → $11.50
    const t = deriveTotals(m(11_498), m(11_498), { ...ZERO_RATES, discBps: 1_000 });
    expect(t.discount).toBe(1_150);
    expect(t.net).toBe(10_348);
    expect(t.total).toBe(10_348);
  });

  it("taxes the DISCOUNTED base, not the gross one", () => {
    // $500 subtotal, 10% off → $450 net; 8.75% of $450 = $39.375 → $39.38
    const t = deriveTotals(m(50_000), m(50_000), { discBps: 1_000, taxBps: 875, depBps: 0 });
    expect(t.net).toBe(45_000);
    expect(t.tax).toBe(3_938);
    expect(t.total).toBe(48_938);
  });

  it("charges tax on the taxable base only, while the untaxed line stays in the total", () => {
    // $400 taxable + $100 non-taxable. Tax base is $400, but the bill is still $500 + tax.
    const t = deriveTotals(m(50_000), m(40_000), { discBps: 0, taxBps: 875, depBps: 0 });
    expect(t.subtotal).toBe(50_000);
    expect(t.tax).toBe(3_500);
    expect(t.total).toBe(53_500);
  });

  it("derives the deposit from the TAX-INCLUSIVE total", () => {
    const t = deriveTotals(m(50_000), m(50_000), { discBps: 0, taxBps: 1_000, depBps: 2_000 });
    expect(t.total).toBe(55_000);
    expect(t.depositDue).toBe(11_000); // 20% of 550.00, not of 500.00
  });

  it("keeps every figure an integer number of cents", () => {
    const t = deriveTotals(m(33_333), m(33_333), { discBps: 333, taxBps: 777, depBps: 1_111 });
    for (const v of Object.values(t)) expect(Number.isInteger(v)).toBe(true);
  });

  it("is total-preserving at 100% discount", () => {
    const t = deriveTotals(m(50_000), m(50_000), { discBps: BPS_DENOMINATOR, taxBps: 875, depBps: 0 });
    expect(t.net).toBe(0);
    expect(t.tax).toBe(0);
    expect(t.total).toBe(0);
  });

  it("handles a zero subtotal without producing negative money", () => {
    const t = deriveTotals(m(0), m(0), { discBps: 1_000, taxBps: 875, depBps: 5_000 });
    expect(t.total).toBe(0);
    expect(t.depositDue).toBe(0);
  });
});
