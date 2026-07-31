import { describe, it, expect } from "vitest";
import { DEFAULT_MARKUP_BANDS, bandFor, deriveSellPriceCents } from "./markup-bands";

describe("markup bands (the org's sliding scale)", () => {
  it("default table is the Profit-Rhino shape: cheap parts marked up hard, equipment gently", () => {
    // $2 fitting → 300% → $8; $1,000 condenser → 25% → $1,250.
    expect(deriveSellPriceCents(200, DEFAULT_MARKUP_BANDS)).toBe(800);
    expect(deriveSellPriceCents(100_000, DEFAULT_MARKUP_BANDS)).toBe(125_000);
  });

  it("picks the highest floor ≤ cost, regardless of row order", () => {
    const bands = [
      { minCostCents: 10_000, markupBps: 5_000 },
      { minCostCents: 0, markupBps: 30_000 },
    ];
    expect(bandFor(10_000, bands)?.markupBps).toBe(5_000);
    expect(bandFor(9_999, bands)?.markupBps).toBe(30_000);
  });

  it("a one-row $0 table is exactly flat-percent pricing", () => {
    expect(deriveSellPriceCents(4_000, [{ minCostCents: 0, markupBps: 3_500 }])).toBe(5_400);
  });

  it("an empty org table falls back to the defaults — never zero markup silently", () => {
    expect(deriveSellPriceCents(200, [])).toBe(800);
  });

  it("a cost below every floor sells at cost, never at zero", () => {
    expect(deriveSellPriceCents(500, [{ minCostCents: 1_000, markupBps: 10_000 }])).toBe(500);
  });
});
