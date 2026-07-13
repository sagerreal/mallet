import { describe, it, expect } from "vitest";
import { serviceCostBasisCents, effectiveMarkupBps, markedUpPriceCents } from "./cost-rollup";

describe("serviceCostBasisCents", () => {
  it("sums unit cost × quantity across attached materials, rounding each line", () => {
    const basis = serviceCostBasisCents([
      { unitCostCents: 1000, quantity: 2 },
      { unitCostCents: 500, quantity: 1 },
    ]);
    expect(basis).toBe(2500);
  });

  it("returns 0 for no attached materials", () => {
    expect(serviceCostBasisCents([])).toBe(0);
  });

  it("rounds each line before summing", () => {
    // 333 * 1.5 = 499.5 → rounds to 500; 333 * 1.5 again = 500; total 1000
    const basis = serviceCostBasisCents([
      { unitCostCents: 333, quantity: 1.5 },
      { unitCostCents: 333, quantity: 1.5 },
    ]);
    expect(basis).toBe(1000);
  });
});

describe("effectiveMarkupBps", () => {
  it("falls back to the org default when the material markup is null", () => {
    expect(effectiveMarkupBps(null, 3500)).toBe(3500);
  });

  it("uses the material's override when present", () => {
    expect(effectiveMarkupBps(5000, 3500)).toBe(5000);
  });
});

describe("markedUpPriceCents", () => {
  it("applies the effective markup bps to the unit cost", () => {
    expect(markedUpPriceCents(1000, 3500)).toBe(1350);
  });

  it("returns the unit cost unchanged at 0 bps", () => {
    expect(markedUpPriceCents(1000, 0)).toBe(1000);
  });
});
