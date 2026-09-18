import { describe, it, expect } from "vitest";
import {
  getDialValue,
  setDialValue,
  dialDisplayValue,
  dialRawValue,
  type DialableAssembly,
} from "./assembly-dials";
import { catalogAssemblyByKey } from "./assembly-defaults";
import { computeAssemblySeed } from "./compute-assembly";

const driveway = catalogAssemblyByKey("driveway_replacement_3in")!;
const sealcoat = catalogAssemblyByKey("sealcoat_two_coats")!;

const dialable = (entry: typeof driveway): DialableAssembly => ({
  marginBps: entry.marginBps,
  jobMinimumCents: entry.jobMinimumCents,
  config: entry.config,
});

describe("getDialValue / setDialValue", () => {
  it("reads the shipped constants through every target kind", () => {
    const a = dialable(driveway);
    expect(getDialValue(a, { kind: "marginBps" })).toBe(2500);
    expect(getDialValue(a, { kind: "jobMinimumCents" })).toBe(250_000);
    expect(getDialValue(a, { kind: "componentField", componentKey: "hma", field: "unitCostCents" })).toBe(12000);
    expect(getDialValue(a, { kind: "componentFactor", componentKey: "hma", index: 0 })).toBe(3);
    expect(getDialValue(dialable(sealcoat), { kind: "tierRate", index: 1 })).toBe(22);
  });

  it("returns null for a target that doesn't resolve — the editor hides it", () => {
    const a = dialable(driveway);
    expect(getDialValue(a, { kind: "componentField", componentKey: "nope", field: "rateCents" })).toBeNull();
    expect(getDialValue(a, { kind: "componentFactor", componentKey: "demo", index: 0 })).toBeNull();
    expect(getDialValue(a, { kind: "tierRate", index: 0 })).toBeNull(); // cost_plus: no tiers
  });

  it("writes immutably — the original assembly slice is untouched", () => {
    const a = dialable(driveway);
    const next = setDialValue(a, { kind: "componentField", componentKey: "hma", field: "unitCostCents" }, 13500);
    expect(next).not.toBeNull();
    expect(getDialValue(next!, { kind: "componentField", componentKey: "hma", field: "unitCostCents" })).toBe(13500);
    expect(getDialValue(a, { kind: "componentField", componentKey: "hma", field: "unitCostCents" })).toBe(12000);
    expect(a.config).toBe(driveway.config);
  });

  it("a dial edit changes what the engine computes (asphalt depth 3→2 in)", () => {
    const a = dialable(driveway);
    const next = setDialValue(a, { kind: "componentFactor", componentKey: "hma", index: 0 }, 2)!;
    const input = {
      areaSqft: 800,
      perimeterLnft: null,
      surface: "flat" as const,
      edges: null,
      complexity: null,
      sourceName: "Drive",
    };
    const before = computeAssemblySeed(
      { name: "d", measurementBasis: "area", pricingMode: "cost_plus", ...a },
      input,
    );
    const after = computeAssemblySeed(
      { name: "d", measurementBasis: "area", pricingMode: "cost_plus", ...next },
      input,
    );
    if (!before.ok || !after.ok) throw new Error("compute failed");
    const tons = (r: typeof after.value) => r.lines.find((l) => l.componentKey === "hma")?.quantity;
    expect(tons(before.value)).toBe(16);
    expect(tons(after.value)).toBe(10.5); // 800×2×145/24000 = 9.67 ×1.07 = 10.34 → 10.5
  });

  it("refuses a write to an unresolvable target (never a silent no-op)", () => {
    const a = dialable(driveway);
    expect(setDialValue(a, { kind: "tierRate", index: 0 }, 99)).toBeNull();
    expect(setDialValue(a, { kind: "componentField", componentKey: "ghost", field: "rateCents" }, 1)).toBeNull();
  });
});

describe("the roofing dial targets", () => {
  const reroof = catalogAssemblyByKey("asphalt_shingle_reroof")!;

  it("configWasteTier reads and writes one tier of the waste table, immutably", () => {
    const a = dialable(reroof);
    expect(getDialValue(a, { kind: "configWasteTier", tier: "simple" })).toBe(1.1);
    expect(getDialValue(a, { kind: "configWasteTier", tier: "cutUp" })).toBe(1.15);
    const next = setDialValue(a, { kind: "configWasteTier", tier: "cutUp" }, 1.12);
    expect(next).not.toBeNull();
    expect(getDialValue(next!, { kind: "configWasteTier", tier: "cutUp" })).toBe(1.12);
    expect(getDialValue(next!, { kind: "configWasteTier", tier: "simple" })).toBe(1.1);
    expect(getDialValue(a, { kind: "configWasteTier", tier: "cutUp" })).toBe(1.15); // untouched
    // A config with no waste table refuses the write.
    expect(setDialValue(dialable(driveway), { kind: "configWasteTier", tier: "simple" }, 1.05)).toBeNull();
  });

  it("componentCount reads/writes a {count:n} basis and rounds to whole units", () => {
    const a = dialable(reroof);
    expect(getDialValue(a, { kind: "componentCount", componentKey: "boots" })).toBe(3);
    const next = setDialValue(a, { kind: "componentCount", componentKey: "boots" }, 4.6);
    expect(getDialValue(next!, { kind: "componentCount", componentKey: "boots" })).toBe(5);
    // Not a count component → unresolvable, refused.
    expect(getDialValue(a, { kind: "componentCount", componentKey: "shingles" })).toBeNull();
    expect(setDialValue(a, { kind: "componentCount", componentKey: "shingles" }, 2)).toBeNull();
  });

  it("componentEdgeToggle removes/adds a class in an edges sum, in canonical order", () => {
    const a = dialable(reroof);
    const target = { kind: "componentEdgeToggle", componentKey: "iw", edge: "eaveFt" } as const;
    expect(getDialValue(a, target)).toBe(1); // shipped ON: eaves + valleys
    const off = setDialValue(a, target, 0);
    expect(getDialValue(off!, target)).toBe(0);
    const backOn = setDialValue(off!, target, 1);
    expect(getDialValue(backOn!, target)).toBe(1);
    // Round-trips byte-identically: the class re-inserts in canonical order.
    expect(JSON.stringify(backOn!.config)).toBe(JSON.stringify(a.config));
  });

  it("componentEdgeToggle refuses to empty an edges sum (never a silent no-op)", () => {
    const a = dialable(reroof);
    const noEaves = setDialValue(
      a,
      { kind: "componentEdgeToggle", componentKey: "iw", edge: "eaveFt" },
      0,
    )!;
    // iw is now valleys-only; removing the last class must refuse.
    expect(
      setDialValue(noEaves, { kind: "componentEdgeToggle", componentKey: "iw", edge: "valleyFt" }, 0),
    ).toBeNull();
  });

  it("toggle format maps 0/1 both ways", () => {
    expect(dialDisplayValue("toggle", 1)).toBe(1);
    expect(dialDisplayValue("toggle", 0)).toBe(0);
    expect(dialRawValue("toggle", 1)).toBe(1);
    expect(dialRawValue("toggle", 0)).toBe(0);
  });
});

describe("display ⇄ raw conversion", () => {
  it("dollars: cents ⇄ dollars", () => {
    expect(dialDisplayValue("dollars", 12000)).toBe(120);
    expect(dialRawValue("dollars", 135.5)).toBe(13550);
  });

  it("percentBps: 2500 bps ⇄ 25%", () => {
    expect(dialDisplayValue("percentBps", 2500)).toBe(25);
    expect(dialRawValue("percentBps", 30)).toBe(3000);
  });

  it("wastePercent: 1.07 multiplier ⇄ 7%", () => {
    expect(dialDisplayValue("wastePercent", 1.07)).toBe(7);
    expect(dialRawValue("wastePercent", 10)).toBe(1.1);
  });

  it("rejects negatives and non-finite input", () => {
    expect(dialRawValue("dollars", -5)).toBeNull();
    expect(dialRawValue("number", Number.NaN)).toBeNull();
  });
});
