import { describe, it, expect } from "vitest";
import {
  computeAssemblySeed,
  wasteTierFor,
  type AssemblyForCompute,
  type AssemblyMeasureInput,
} from "./compute-assembly";
import { catalogAssemblyByKey, DEFAULT_ASSEMBLIES } from "./assembly-defaults";
import { setDialValue } from "./assembly-dials";
import { parseAssemblyConfig } from "./assembly-config";

/**
 * The engine's math, pinned against the estimating research's worked examples:
 *  - 800 sqft driveway replacement ≈ $10,100 (±rounding) at the shipped constants
 *  - 3,000 sqft sealcoat = $660 seal line (mid tier)
 *  - the 24-square roof (6/12; eaves 160 / rakes 100 / ridge 40 / hips 60 /
 *    valleys 30; waste 12%) ≈ $15,200 ±5% — LINE/COUNT component bases,
 *    complexity-derived waste, the ice-dam toggle
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

/** Flat paving surfaces: no roof classification. */
const flatInput = (
  areaSqft: number,
  perimeterLnft: number | null,
  sourceName = "Driveway",
): AssemblyMeasureInput => ({
  areaSqft,
  perimeterLnft,
  surface: "flat",
  edges: null,
  complexity: null,
  sourceName,
});

const seed = (key: string, areaSqft: number, perimeterLnft: number | null, sourceName = "Driveway") => {
  const result = computeAssemblySeed(forCompute(key), flatInput(areaSqft, perimeterLnft, sourceName));
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
    const result = computeAssemblySeed(forCompute("crack_filling"), flatInput(900, null, "Main lot"));
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
    expect(result.skipped).toEqual([{ label: "Edge restraint", need: "perimeter" }]);
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
    const result = computeAssemblySeed(
      forCompute("driveway_replacement_3in"),
      flatInput(0, 100, "Patio"),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("no measured area");
  });

  it("a line-basis assembly refuses an unclassified surface, naming the fix", () => {
    const assembly: AssemblyForCompute = {
      ...forCompute("crack_filling"),
      measurementBasis: "line",
    };
    const result = computeAssemblySeed(assembly, flatInput(0, 100, "Edge"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("classify the edges");
  });

  it("a count-basis UNIT_RATE assembly is refused — no single sell line exists", () => {
    const assembly: AssemblyForCompute = {
      ...forCompute("crack_filling"), // unit_rate donor config
      measurementBasis: "count",
    };
    const result = computeAssemblySeed(assembly, flatInput(0, 100, "Edge"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("cost-plus");
  });
});

// ─── roofing ──────────────────────────────────────────────────────────────────

const ROOF_EDGES = { eaveFt: 160, rakeFt: 100, ridgeFt: 40, hipFt: 60, valleyFt: 30 };

/** The research's 24-square roof: 6/12, classified, hips AND valleys. */
const roofInput = (overrides: Partial<AssemblyMeasureInput> = {}): AssemblyMeasureInput => ({
  areaSqft: 2400,
  perimeterLnft: 260,
  surface: "pitched",
  edges: ROOF_EDGES,
  complexity: { hips: 2, valleys: 1, cutUp: true },
  sourceName: "Main roof at 6/12",
  ...overrides,
});

const REROOF = forCompute("asphalt_shingle_reroof");

const quantityOf = (
  result: { lines: readonly { componentKey: string | null; quantity: number }[] },
  key: string,
): number | undefined => result.lines.find((line) => line.componentKey === key)?.quantity;

describe("asphalt shingle reroof — the research's 24-square worked example", () => {
  // The example runs at 12% waste ("waste 12%" is given). This roof carries
  // hips AND valleys, so the DERIVED tier is cut-up (15%); the example's 12%
  // is the override story — turn the cut-up waste dial to 12 and every listed
  // quantity pins. The shipped-default derivation is pinned separately below.
  const dialed = setDialValue(
    { marginBps: REROOF.marginBps, jobMinimumCents: REROOF.jobMinimumCents, config: REROOF.config },
    { kind: "configWasteTier", tier: "cutUp" },
    1.12,
  );
  if (dialed === null) throw new Error("waste dial did not resolve");
  const result = (() => {
    const computed = computeAssemblySeed({ ...REROOF, config: dialed.config }, roofInput());
    if (!computed.ok) throw new Error(computed.error.message);
    return computed.value;
  })();

  it("field shingles: 24 sq × 3 bundles × 1.12 = 80.64 → 81 bundles", () => {
    expect(quantityOf(result, "shingles")).toBe(81);
    const shingles = result.lines.find((line) => line.componentKey === "shingles");
    expect(shingles).toMatchObject({
      description: "Field shingles (81 bundles)",
      costCents: 4200,
      rateCents: 5250, // $42 +25% margin, applied INTO the rate
    });
  });

  it("hip & ridge cap rides the classed linears: (40+60)/25 × 1.12 = 4.48 → 5 bundles", () => {
    expect(quantityOf(result, "cap")).toBe(5);
  });

  it("starter strip: (160 eaves + 100 rakes)/105 = 2.48 → 3 rolls", () => {
    expect(quantityOf(result, "starter")).toBe(3);
  });

  it("synthetic underlayment: 26.88 waste-applied squares / 10 = 2.69 → 3 rolls", () => {
    expect(quantityOf(result, "underlayment")).toBe(3);
  });

  it("ice & water: (160×3 eave + 30×3 valley)/200 = 2.85 → 3 rolls", () => {
    expect(quantityOf(result, "iw")).toBe(3);
  });

  it("drip edge: (160+100)/10 = 26 sticks + 2 spares AFTER pack rounding = 28", () => {
    expect(quantityOf(result, "drip")).toBe(28);
    expect(result.lines.find((line) => line.componentKey === "drip")?.description).toBe(
      "Drip edge (28 sticks)",
    );
  });

  it("coil nails: 26.88 waste-applied squares / 20 = 1.34 → 2 boxes", () => {
    expect(quantityOf(result, "nails")).toBe(2);
  });

  it("pipe boots seed from the COUNT dial (3 by default)", () => {
    expect(quantityOf(result, "boots")).toBe(3);
  });

  it("tear-off and install price per SQUARE (labor factors): 24 sq each; 1 dumpster; permit", () => {
    expect(quantityOf(result, "tearoff")).toBe(24);
    expect(quantityOf(result, "install")).toBe(24);
    expect(quantityOf(result, "dumpster")).toBe(1); // ceil(2400 sqft / 2400 per load)
    expect(quantityOf(result, "permit")).toBe(1);
  });

  it("totals ≈ $15,200 ±5% at the listed constants — inside the $450–700/square retail band", () => {
    expect(result.totalCents).toBe(1_594_250); // $15,942.50 exactly
    expect(Math.abs(result.totalCents - 1_520_000)).toBeLessThanOrEqual(1_520_000 * 0.05);
    const perSquare = result.totalCents / 24;
    expect(perSquare).toBeGreaterThanOrEqual(45_000);
    expect(perSquare).toBeLessThanOrEqual(70_000);
    expect(result.minimum).toBeNull(); // $3,500 minimum well cleared
  });

  it("reports the waste it applied — the dialed 12%, named honestly", () => {
    expect(result.derivedWaste).toEqual({ percent: 12, reason: "cut-up roof" });
  });
});

describe("waste derives from complexity (shipped defaults)", () => {
  const seedRoof = (complexity: { hips: number; valleys: number }) => {
    const result = computeAssemblySeed(
      REROOF,
      roofInput({ complexity: { ...complexity, cutUp: complexity.hips + complexity.valleys > 0 } }),
    );
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  };

  it("tier rule: simple = no hips/valleys; cut-up = both, or either ≥3; moderate otherwise", () => {
    expect(wasteTierFor({ hips: 0, valleys: 0, cutUp: false })).toBe("simple");
    expect(wasteTierFor({ hips: 2, valleys: 0, cutUp: true })).toBe("moderate");
    expect(wasteTierFor({ hips: 0, valleys: 2, cutUp: true })).toBe("moderate");
    expect(wasteTierFor({ hips: 1, valleys: 1, cutUp: true })).toBe("cutUp");
    expect(wasteTierFor({ hips: 3, valleys: 0, cutUp: true })).toBe("cutUp");
    expect(wasteTierFor({ hips: 0, valleys: 3, cutUp: true })).toBe("cutUp");
  });

  it("a simple gable derives 10%: 72 × 1.10 = 79.2 → 80 bundles", () => {
    const result = seedRoof({ hips: 0, valleys: 0 });
    expect(quantityOf(result, "shingles")).toBe(80);
    expect(result.derivedWaste).toEqual({ percent: 10, reason: "simple roof" });
  });

  it("hips alone derive 12% and say so: 'hips on this roof'", () => {
    const result = seedRoof({ hips: 2, valleys: 0 });
    expect(quantityOf(result, "shingles")).toBe(81);
    expect(result.derivedWaste).toEqual({ percent: 12, reason: "hips on this roof" });
  });

  it("valleys alone derive 12% and say so: 'valleys on this roof'", () => {
    const result = seedRoof({ hips: 0, valleys: 2 });
    expect(result.derivedWaste).toEqual({ percent: 12, reason: "valleys on this roof" });
  });

  it("hips AND valleys derive the cut-up 15%: 72 × 1.15 = 82.8 → 83 bundles", () => {
    const result = seedRoof({ hips: 2, valleys: 1 });
    expect(quantityOf(result, "shingles")).toBe(83);
    expect(result.derivedWaste).toEqual({ percent: 15, reason: "cut-up roof" });
  });
});

describe("reroof against imperfect surfaces", () => {
  it("an UNCLASSIFIED pitched trace prices the area components and names every edge gap", () => {
    const computed = computeAssemblySeed(REROOF, roofInput({ edges: null, complexity: null }));
    if (!computed.ok) throw new Error(computed.error.message);
    const result = computed.value;
    // Area math falls back to the flat 12% wasteFactor — but NOTHING derived.
    expect(quantityOf(result, "shingles")).toBe(81);
    expect(result.derivedWaste).toBeNull();
    // Every classed-linear component is a LOUD named gap, in recipe order.
    expect(result.skipped).toEqual([
      { label: "Hip and ridge cap", need: "edges" },
      { label: "Starter strip", need: "edges" },
      { label: "Ice and water shield", need: "edges" },
      { label: "Drip edge", need: "edges" },
    ]);
  });

  it("a FLAT surface is refused up front — a shingle recipe can't price a driveway", () => {
    const result = computeAssemblySeed(REROOF, flatInput(2400, 260, "Back lot"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("pitched roofs");
  });

  it("a classified roof with NO valleys owes no valley courses — zero linears drop silently", () => {
    const computed = computeAssemblySeed(
      REROOF,
      roofInput({
        edges: { ...ROOF_EDGES, hipFt: 0, valleyFt: 0 },
        complexity: { hips: 0, valleys: 0, cutUp: false },
      }),
    );
    if (!computed.ok) throw new Error(computed.error.message);
    // Cap still prices from ridge alone: 40/25 × 1.10 = 1.76 → 2 bundles.
    expect(quantityOf(computed.value, "cap")).toBe(2);
    expect(computed.value.skipped).toEqual([]); // nothing missing, nothing loud
  });
});

describe("the ice-dam toggle (componentEdgeToggle dial)", () => {
  it("OFF drops the eave courses and keeps the valleys: 30×3/200 = 0.45 → 1 roll", () => {
    const dialed = setDialValue(
      { marginBps: REROOF.marginBps, jobMinimumCents: REROOF.jobMinimumCents, config: REROOF.config },
      { kind: "componentEdgeToggle", componentKey: "iw", edge: "eaveFt" },
      0,
    );
    if (dialed === null) throw new Error("toggle did not resolve");
    const result = computeAssemblySeed({ ...REROOF, config: dialed.config }, roofInput());
    if (!result.ok) throw new Error(result.error.message);
    expect(quantityOf(result.value, "iw")).toBe(1);
  });

  it("OFF on a roof with no valleys drops ice & water entirely — silently, it's configured off", () => {
    const dialed = setDialValue(
      { marginBps: REROOF.marginBps, jobMinimumCents: REROOF.jobMinimumCents, config: REROOF.config },
      { kind: "componentEdgeToggle", componentKey: "iw", edge: "eaveFt" },
      0,
    );
    if (dialed === null) throw new Error("toggle did not resolve");
    const result = computeAssemblySeed(
      { ...REROOF, config: dialed.config },
      roofInput({
        edges: { ...ROOF_EDGES, valleyFt: 0 },
        complexity: { hips: 2, valleys: 0, cutUp: true },
      }),
    );
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.lines.some((line) => line.componentKey === "iw")).toBe(false);
    expect(result.value.skipped).toEqual([]);
  });
});

describe("the pipe-boot COUNT dial", () => {
  it("dialing the count reprices the line; dialing it to 0 removes it (configured off)", () => {
    const base = {
      marginBps: REROOF.marginBps,
      jobMinimumCents: REROOF.jobMinimumCents,
      config: REROOF.config,
    };
    const five = setDialValue(base, { kind: "componentCount", componentKey: "boots" }, 5);
    if (five === null) throw new Error("count dial did not resolve");
    const withFive = computeAssemblySeed({ ...REROOF, config: five.config }, roofInput());
    if (!withFive.ok) throw new Error(withFive.error.message);
    expect(quantityOf(withFive.value, "boots")).toBe(5);

    const zero = setDialValue(base, { kind: "componentCount", componentKey: "boots" }, 0);
    if (zero === null) throw new Error("count dial did not resolve");
    const without = computeAssemblySeed({ ...REROOF, config: zero.config }, roofInput());
    if (!without.ok) throw new Error(without.error.message);
    expect(without.value.lines.some((line) => line.componentKey === "boots")).toBe(false);
    expect(without.value.skipped).toEqual([]);
  });
});

describe("roof tune-up / repair allowance", () => {
  const TUNEUP = forCompute("roof_tuneup");

  it("24 squares: $200 visit + 24 × $15 allowance, +25% = $700", () => {
    const result = computeAssemblySeed(TUNEUP, roofInput());
    if (!result.ok) throw new Error(result.error.message);
    expect(quantityOf(result.value, "repairs")).toBe(24);
    expect(result.value.totalCents).toBe(70_000);
    expect(result.value.minimum).toBeNull();
  });

  it("a small roof lands ON the $450 minimum, loudly", () => {
    const result = computeAssemblySeed(TUNEUP, roofInput({ areaSqft: 800 }));
    if (!result.ok) throw new Error(result.error.message);
    // ($200 + 8 × $15) × 1.25 = $400 → minimum adds $50.
    expect(result.value.minimum).toEqual({ minimumCents: 45_000, addedCents: 5_000 });
    expect(result.value.totalCents).toBe(45_000);
  });

  it("works UNCLASSIFIED — a pitched area is all it needs", () => {
    const result = computeAssemblySeed(TUNEUP, roofInput({ edges: null, complexity: null }));
    expect(result.ok).toBe(true);
  });
});

describe("a LINE-basis unit-rate assembly sells the summed classed linears", () => {
  it("quantity = every classed linear: 160+100+40+60+30 = 390 lnft", () => {
    const assembly: AssemblyForCompute = {
      name: "Fascia wrap",
      measurementBasis: "line",
      pricingMode: "unit_rate",
      marginBps: 0,
      jobMinimumCents: 0,
      config: {
        version: 1,
        components: [
          {
            kind: "material",
            key: "coil",
            label: "Aluminum coil",
            basis: { edges: ["eaveFt", "rakeFt"] },
            factors: [1 / 50],
            wasteFactor: 1.1,
            packSize: 1,
            unit: "rolls",
            unitCostCents: 9000,
          },
        ],
        tiers: [{ upToQty: null, rateCents: 800 }],
      },
    };
    const result = computeAssemblySeed(assembly, roofInput());
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.lines[0]).toMatchObject({ quantity: 390, rateCents: 800 });
  });
});
