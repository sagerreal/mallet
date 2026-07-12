/**
 * app/(office)/composer/gbb-suggest.test.ts
 * Unit tests for the "Suggest Better & Best from Good" heuristics — the
 * job-type classifier, the trade seeds (water heater / drain / toilet), and
 * the generic fallback derived from the Good tier's lines. Pure functions,
 * NOT AI — the tests pin that contract: Good is preserved verbatim, only
 * Better & Best are written, and Better gets the star.
 */

import { describe, it, expect } from "vitest";
import { jobTypeOf, suggestFromGood } from "./gbb-suggest";
import type { ComposerLine, GBBTier } from "./composer-state";

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function line(d: string, q = 1, r = 0): ComposerLine {
  return { d, q, r };
}

function makeGood(lines: ComposerLine[], overrides: Partial<GBBTier> = {}): GBBTier {
  return { k: "good", name: "Good", title: "", note: "", lines, ...overrides };
}

// ---------------------------------------------------------------------------
// jobTypeOf — the classifier
// ---------------------------------------------------------------------------

describe("jobTypeOf", () => {
  it("classifies water-heater wording", () => {
    expect(jobTypeOf("Replace 40-gal water heater")).toBe("water heater");
    expect(jobTypeOf("tankless conversion quote")).toBe("water heater");
    expect(jobTypeOf("customer has NO HOT WATER since Tuesday")).toBe("water heater");
    expect(jobTypeOf("pilot keeps going out")).toBe("water heater");
  });

  it("classifies drain wording", () => {
    expect(jobTypeOf("kitchen drain backing up")).toBe("drain");
    expect(jobTypeOf("main line CLOG")).toBe("drain");
    expect(jobTypeOf("sewer camera inspection")).toBe("drain");
    expect(jobTypeOf("hydro jet the line")).toBe("drain");
  });

  it("classifies toilet wording", () => {
    expect(jobTypeOf("toilet rocking at the base")).toBe("toilet");
  });

  it("falls back to general for everything else — including empty text", () => {
    expect(jobTypeOf("regrout the shower pan")).toBe("general");
    expect(jobTypeOf("")).toBe("general");
  });

  it("checks water heater before drain when the wording matches both", () => {
    expect(jobTypeOf("camera the water heater flue")).toBe("water heater");
  });
});

// ---------------------------------------------------------------------------
// suggestFromGood — trade seeds
// ---------------------------------------------------------------------------

describe("suggestFromGood (trade seeds)", () => {
  const goodLines = [line("Relight & service existing heater", 1, 220)];

  it("recommends Better — the seeds' default star", () => {
    const draft = suggestFromGood(makeGood(goodLines), "water heater replacement");
    expect(draft.rec).toBe("better");
  });

  it("keeps the user's Good tier verbatim as the first option", () => {
    const good = makeGood(goodLines, { name: "Basic", title: "Just the fix" });
    const draft = suggestFromGood(good, "water heater replacement");

    expect(draft.opts[0]!.k).toBe("good");
    expect(draft.opts[0]!.name).toBe("Basic");
    expect(draft.opts[0]!.title).toBe("Just the fix");
    expect(draft.opts[0]!.lines).toEqual(goodLines);
  });

  it("clones Good's lines — editing the draft never mutates the input tier", () => {
    const good = makeGood([line("Relight & service", 1, 220)]);
    const draft = suggestFromGood(good, "water heater replacement");

    draft.opts[0]!.lines[0]!.d = "MUTATED";
    expect(good.lines[0]!.d).toBe("Relight & service");
  });

  it("fills Better & Best from the water-heater seed", () => {
    const draft = suggestFromGood(makeGood(goodLines), "no hot water");
    const better = draft.opts[1]!;
    const best = draft.opts[2]!;

    expect(better.k).toBe("better");
    expect(better.title).toBe("Replace + bring to code");
    expect(better.lines.map((l) => l.d)).toContain(
      "40-gal gas water heater (Rheem Performance)"
    );

    expect(best.k).toBe("best");
    expect(best.title).toBe("Tankless upgrade");
    expect(best.lines.map((l) => l.d)).toContain("Tankless unit (Navien NPE-240)");
  });

  it("fills Better & Best from the drain seed", () => {
    const draft = suggestFromGood(makeGood([line("Snake the line", 1, 250)]), "kitchen drain clog");
    const better = draft.opts[1]!;
    const best = draft.opts[2]!;

    expect(better.lines).toEqual([
      line("Hydro-jet the line", 1, 450),
      line("Camera inspection w/ locate", 1, 285),
    ]);
    expect(best.lines.map((l) => l.d)).toContain("Install exterior cleanout");
  });

  it("fills Better & Best from the toilet seed", () => {
    const draft = suggestFromGood(makeGood([line("Reset & reseal toilet", 1, 180)]), "toilet leaking");
    const better = draft.opts[1]!;
    const best = draft.opts[2]!;

    expect(better.lines.map((l) => l.d)).toContain(
      "Toilet — Toto Drake, supplied & installed"
    );
    expect(best.lines.map((l) => l.d)).toContain(
      "Toilet — Toto Drake II comfort height, supplied & installed"
    );
  });

  it("clones the seed lines — editing one draft never bleeds into the next", () => {
    const first = suggestFromGood(makeGood(goodLines), "water heater");
    first.opts[1]!.lines[0]!.d = "MUTATED";
    first.opts[1]!.lines[0]!.r = 1;

    const second = suggestFromGood(makeGood(goodLines), "water heater");
    expect(second.opts[1]!.lines[0]).toEqual(
      line("40-gal gas water heater (Rheem Performance)", 1, 1650)
    );
  });
});

// ---------------------------------------------------------------------------
// suggestFromGood — generic fallback (derived from Good's lines)
// ---------------------------------------------------------------------------

describe("suggestFromGood (generic fallback)", () => {
  it("builds Better as Good's lines plus a maintenance line at ~12% (rounded to $10)", () => {
    const good = makeGood([line("Repipe laundry room", 1, 1000)]);
    const draft = suggestFromGood(good, "regrout shower pan");
    const better = draft.opts[1]!;

    expect(better.title).toBe("Job + protection");
    expect(better.lines).toEqual([
      line("Repipe laundry room", 1, 1000),
      line("Preventive maintenance & 12-mo protection", 1, 120), // 1000 × 0.12 → 120
    ]);
  });

  it("floors the maintenance line at $89 for small jobs", () => {
    const good = makeGood([line("Tighten fittings", 2, 100)]); // sum 200 → 12% = 24 → rounds to 20 → floor 89
    const draft = suggestFromGood(good, "misc repair");
    const maintenance = draft.opts[1]!.lines.at(-1)!;
    expect(maintenance.r).toBe(89);
  });

  it("builds Best as one full-upgrade line at ~1.8× (rounded to $10)", () => {
    const good = makeGood([line("Repipe laundry room", 1, 1000)]);
    const draft = suggestFromGood(good, "regrout shower pan");
    const best = draft.opts[2]!;

    expect(best.title).toBe("Full upgrade");
    expect(best.lines).toEqual([
      line("Full replacement / upgrade (scoped on site)", 1, 1800),
    ]);
  });

  it("ignores blank Good lines when deriving the tiers", () => {
    const good = makeGood([line(""), line("Repipe laundry room", 1, 1000), line("   ")]);
    const draft = suggestFromGood(good, "something unclassified");
    const better = draft.opts[1]!;

    expect(better.lines.map((l) => l.d)).toEqual([
      "Repipe laundry room",
      "Preventive maintenance & 12-mo protection",
    ]);
  });

  it("uses the placeholder base when Good has no real lines", () => {
    const good = makeGood([line("")]);
    const draft = suggestFromGood(good, "something unclassified");
    const better = draft.opts[1]!;
    const best = draft.opts[2]!;

    // base = Labor & materials $850 → maintenance 850 × 0.12 = 102 → rounds to 100
    expect(better.lines).toEqual([
      line("Labor & materials — as described", 1, 850),
      line("Preventive maintenance & 12-mo protection", 1, 100),
    ]);
    // best = 850 × 1.8 = 1530
    expect(best.lines).toEqual([
      line("Full replacement / upgrade (scoped on site)", 1, 1530),
    ]);
  });

  it("still recommends Better and keeps Good verbatim in fallback mode", () => {
    const goodLines = [line("Custom work", 1, 400)];
    const draft = suggestFromGood(makeGood(goodLines), "unclassifiable job");
    expect(draft.rec).toBe("better");
    expect(draft.opts[0]!.lines).toEqual(goodLines);
  });
});
