import { describe, it, expect } from "vitest";
import { computeAssemblySeed, type AssemblyForCompute } from "./compute-assembly";
import { catalogAssemblyByKey, DEFAULT_ASSEMBLIES } from "./assembly-defaults";
import { parseAssemblyConfig } from "./assembly-config";

/**
 * The engine's math, pinned against the estimating research's worked examples:
 *  - 800 sqft driveway replacement ≈ $10,100 (±rounding) at the shipped constants
 *  - 3,000 sqft sealcoat = $660 seal line (mid tier)
 *  - tier selection, minimum trigger, pack rounding, waste-THEN-pack order
 */

const forCompute = (key: string): AssemblyForCompute => {
  const entry = catalogAssemblyByKey(key);
  if (!entry) throw new Error(`no catalog assembly ${key}`);
  return {
    name: entry.name,
    measurementBasis: entry.measurementBasis,
    pricingMode: entry.pricingMode,
    marginBps: entry.marginBps,
    jobMinimumCents: entry.jobMinimumCents,
    config: entry.config,
  };
};

const seed = (key: string, areaSqft: number, perimeterLnft: number | null, sourceName = "Driveway") => {
  const result = computeAssemblySeed(forCompute(key), { areaSqft, perimeterLnft, sourceName });
  if (!result.ok) throw new Error(`compute failed: ${result.error.message}`);
  return result.value;
};

describe("catalog self-check", () => {
  it("every shipped config passes the boundary schema", () => {
    for (const entry of DEFAULT_ASSEMBLIES) {
      const parsed = parseAssemblyConfig(entry.config);
      expect(parsed.ok, `${entry.catalogKey}: ${parsed.ok ? "" : parsed.error.message}`).toBe(true);
    }
  });

  it("every dial resolves against its own config", async () => {
    const { getDialValue } = await import("./assembly-dials");
    for (const entry of DEFAULT_ASSEMBLIES) {
      for (const dial of entry.dials) {
        const value = getDialValue(
          { marginBps: entry.marginBps, jobMinimumCents: entry.jobMinimumCents, config: entry.config },
          dial.target,
        );
        expect(value, `${entry.catalogKey}.${dial.key}`).not.toBeNull();
      }
    }
  });

  it("catalog keys are unique", () => {
    const keys = DEFAULT_ASSEMBLIES.map((entry) => entry.catalogKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("driveway replacement, 3-inch — the research's 800 sqft worked example", () => {
  const result = seed("driveway_replacement_3in", 800, 120);

  it("produces the seven component lines in recipe order", () => {
    expect(result.lines.map((line) => line.componentKey)).toEqual([
      "demo",
      "grading",
      "base",
      "hma",
      "crew",
      "mob",
      "trucking",
    ]);
  });

  it("hot-mix: 800×3×145/24000 = 14.5 t, ×1.07 waste = 15.52, pack-rounds to 16 t", () => {
    const hma = result.lines.find((line) => line.componentKey === "hma");
    expect(hma).toMatchObject({
      description: "Hot-mix asphalt, 3 in (16 tons)",
      quantity: 16,
      costCents: 12000,
      rateCents: 15000, // $120 cost +25% margin, applied INTO the line rate
    });
  });

  it("base stone: 800×2×1.5/324 = 7.41 t → 7.5 t at the half-ton pack", () => {
    const base = result.lines.find((line) => line.componentKey === "base");
    expect(base).toMatchObject({ quantity: 7.5, rateCents: 5000, costCents: 4000 });
  });

  it("trucking sources the PACK-ROUNDED asphalt tonnage: ceil(16/20) = 1 load", () => {
    const trucking = result.lines.find((line) => line.componentKey === "trucking");
    expect(trucking).toMatchObject({
      description: "Trucking (1 load)",
      quantity: 1,
      rateCents: 56250, // $450 +25%
    });
  });

  it("crew: 1 day per ≤2,500 sqft; mobilization flat — both margined", () => {
    expect(result.lines.find((line) => line.componentKey === "crew")).toMatchObject({
      quantity: 1,
      rateCents: 375000,
    });
    expect(result.lines.find((line) => line.componentKey === "mob")).toMatchObject({
      quantity: 1,
      rateCents: 62500,
    });
  });

  it("totals ≈ $10,100 at the listed constants (±rounding)", () => {
    // 1752.00 + 704.00 + 375.00 + 2400.00 + 3750.00 + 625.00 + 562.50 = 10,168.50
    expect(result.totalCents).toBe(1_016_850);
    expect(Math.abs(result.totalCents - 1_010_000)).toBeLessThan(15_000);
  });

  it("clears the $2,500 minimum — no minimum line, no notice", () => {
    expect(result.minimum).toBeNull();
    expect(result.lines.some((line) => line.description === "Job minimum")).toBe(false);
  });

  it("cost rides per-unit on every line, never margined", () => {
    for (const line of result.lines) {
      expect(line.costCents).toBeLessThanOrEqual(line.rateCents);
    }
  });
});

describe("waste is applied BEFORE pack rounding", () => {
  it("14.5 t × 1.07 = 15.52 → 16 t; rounding first would give 15.5 t", () => {
    const hma = seed("driveway_replacement_3in", 800, null).lines.find(
      (line) => line.componentKey === "hma",
    );
    expect(hma?.quantity).toBe(16); // waste→round; the wrong order yields 15.5
  });

  it("a quantity already on the pack boundary does not jump a pack (float guard)", () => {
    // 900 sqft × 2 × 1.5/324 = 8.333… → 8.5; 972 sqft → exactly 9.0 stays 9.0
    const base = seed("driveway_replacement_3in", 972, null).lines.find(
      (line) => line.componentKey === "base",
    );
    expect(base?.quantity).toBe(9);
  });
});

describe("sealcoat, two coats — unit-rate tiers", () => {
  it("3,000 sqft lands in the ≤5,000 bracket: one $0.22 line = $660", () => {
    const result = seed("sealcoat_two_coats", 3000, null, "Driveway");
    const sell = result.lines[0]!;
    expect(sell).toMatchObject({
      description: "Driveway — Sealcoat, two coats",
      quantity: 3000,
      rateCents: 22,
    });
    expect(Math.round(sell.quantity * sell.rateCents)).toBe(66_000);
    expect(result.minimum).toBeNull();
  });

  it("tier selection: 2,000 sqft holds the small bracket; 2,001 crosses; 5,001 hits the open bracket", () => {
    expect(seed("sealcoat_two_coats", 2000, null).lines[0]!.rateCents).toBe(25);
    expect(seed("sealcoat_two_coats", 2001, null).lines[0]!.rateCents).toBe(22);
    expect(seed("sealcoat_two_coats", 5001, null).lines[0]!.rateCents).toBe(18);
  });

  it("carries the true per-unit COST behind the sell rate (sealer + sand + crew)", () => {
    const sell = seed("sealcoat_two_coats", 3000, null).lines[0]!;
    // 49 gal × $3.50 + 150 lb × $0.16 + 4 hr × $80 = 171.50 + 24.00 + 320.00 = $515.50
    expect(sell.costCents).toBe(Math.round(51_550 / 3000));
  });

  it("below the $350 minimum: a 800 sqft lot ($200) gains a $150 'Job minimum' line", () => {
    const result = seed("sealcoat_two_coats", 800, null);
    expect(result.minimum).toEqual({ minimumCents: 35_000, addedCents: 15_000 });
    const minLine = result.lines.find((line) => line.description === "Job minimum");
    expect(minLine).toMatchObject({ quantity: 1, rateCents: 15_000, costCents: 0 });
    expect(result.totalCents).toBe(35_000); // priced AT the minimum
  });
});

describe("crack filling — perimeter basis as the line stand-in", () => {
  it("300 lnft: $1.50/lnft sell line, 2 boxes of hot-pour behind it", () => {
    const result = seed("crack_filling", 0, 300, "Lot edge");
    const sell = result.lines[0]!;
    expect(sell).toMatchObject({ quantity: 300, rateCents: 150 });
    // ceil(300/275) = 2 boxes × $60 = $120 → 40¢/lnft cost
    expect(sell.costCents).toBe(40);
  });

  it("refuses a surface with no perimeter", () => {
    const result = computeAssemblySeed(forCompute("crack_filling"), {
      areaSqft: 900,
      perimeterLnft: null,
      sourceName: "Main lot",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("no measured perimeter");
  });
});

describe("paver driveway — mixed area + perimeter components", () => {
  it("600 sqft / 100 lnft: mid tier $22/sqft, minimum cleared", () => {
    const result = seed("paver_driveway", 600, 100);
    expect(result.lines[0]!).toMatchObject({ quantity: 600, rateCents: 2200 });
    expect(result.minimum).toBeNull();
  });

  it("a manual capture (no perimeter) skips edge restraint LOUDLY, not silently", () => {
    const result = seed("paver_driveway", 600, null);
    expect(result.skipped).toContain("Edge restraint");
  });

  it("100 sqft courtyard is priced at the $3,000 minimum", () => {
    const result = seed("paver_driveway", 100, 40);
    expect(result.minimum?.minimumCents).toBe(300_000);
    expect(result.totalCents).toBe(300_000);
  });
});

describe("asphalt overlay — optional perimeter component", () => {
  it("edge milling seeds as an OPTIONAL line and stays out of the billed total", () => {
    const result = seed("asphalt_overlay_15in", 2000, 200);
    const milling = result.lines.find((line) => line.componentKey === "milling");
    expect(milling).toMatchObject({ optional: true, quantity: 200, rateCents: 250 });
    const nonOptional = result.lines
      .filter((line) => !line.optional)
      .reduce((sum, line) => sum + Math.round(line.quantity * line.rateCents), 0);
    expect(result.totalCents).toBe(nonOptional);
  });

  it("tack coat: 2,000 sqft → 2000/9×0.07 = 15.6 gal → 16 whole gallons", () => {
    const tack = seed("asphalt_overlay_15in", 2000, null).lines.find(
      (line) => line.componentKey === "tack",
    );
    expect(tack?.quantity).toBe(16);
  });
});

describe("guards", () => {
  it("area assembly refuses a zero-area input", () => {
    const result = computeAssemblySeed(forCompute("driveway_replacement_3in"), {
      areaSqft: 0,
      perimeterLnft: 100,
      sourceName: "Patio",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("no measured area");
  });

  it("line/count bases are declared but refuse to compute (later PR)", () => {
    const assembly: AssemblyForCompute = {
      ...forCompute("crack_filling"),
      measurementBasis: "line",
    };
    const result = computeAssemblySeed(assembly, { areaSqft: 0, perimeterLnft: 100, sourceName: "Edge" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("can't seed yet");
  });
});
