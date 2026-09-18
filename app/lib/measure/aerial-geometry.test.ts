import { describe, it, expect } from "vitest";
import {
  sqMetersToSqft,
  metersToFeet,
  round2,
  pitchLabel,
  pitchCorrectedAreaPreview,
  formatSqft,
  formatLnft,
  surfaceSummary,
  nextSurfaceName,
  parsePitchInput,
  PITCH_PRESETS,
} from "./aerial-geometry";

describe("unit conversion", () => {
  it("converts square meters to square feet", () => {
    expect(sqMetersToSqft(1)).toBeCloseTo(10.7639, 3);
    expect(sqMetersToSqft(0)).toBe(0);
  });

  it("converts meters to feet", () => {
    expect(metersToFeet(0.3048)).toBeCloseTo(1, 10);
    expect(metersToFeet(100)).toBeCloseTo(328.084, 3);
  });

  it("round2 rounds to two decimals", () => {
    expect(round2(1234.5678)).toBe(1234.57);
    expect(round2(1)).toBe(1);
  });
});

describe("pitch math", () => {
  it("matches the server formula: footprint / cos(atan(rise/12))", () => {
    // 6/12: slope factor 1.118033…
    expect(pitchCorrectedAreaPreview(1240, 6)).toBeCloseTo(1386.36, 2);
    // 12/12 = 45°: factor √2.
    expect(pitchCorrectedAreaPreview(1000, 12)).toBeCloseTo(1414.21, 2);
  });

  it("labels pitch as rise per 12", () => {
    expect(pitchLabel(6)).toBe("6/12");
    expect(pitchLabel(12)).toBe("12/12");
  });

  it("offers the common presets", () => {
    expect(PITCH_PRESETS).toEqual([4, 6, 8, 10]);
  });
});

describe("formatting", () => {
  it("formats square feet with thousands separators, no decimals", () => {
    expect(formatSqft(1240.4)).toBe("1,240 sqft");
    expect(formatSqft(999.6)).toBe("1,000 sqft");
  });

  it("formats linear feet", () => {
    expect(formatLnft(142.3)).toBe("142 lnft");
  });
});

describe("surfaceSummary", () => {
  it("flat surface is just the area", () => {
    expect(
      surfaceSummary({ surface: "flat", pitchRise: null, areaSqft: 1240, footprintSqft: 1240 }),
    ).toBe("1,240 sqft");
  });

  it("pitched surface shows footprint, roof area, and pitch", () => {
    expect(
      surfaceSummary({ surface: "pitched", pitchRise: 6, areaSqft: 1433, footprintSqft: 1240 }),
    ).toBe("Footprint 1,240 sqft · Roof area 1,433 sqft at 6/12");
  });

  it("pitched surface without a footprint (manual) falls back to the area alone", () => {
    expect(
      surfaceSummary({ surface: "pitched", pitchRise: 6, areaSqft: 1433, footprintSqft: null }),
    ).toBe("1,433 sqft");
  });
});

describe("nextSurfaceName", () => {
  it("starts at Surface 1", () => {
    expect(nextSurfaceName([])).toBe("Surface 1");
  });

  it("takes the lowest free number", () => {
    expect(nextSurfaceName(["Surface 1", "Surface 2"])).toBe("Surface 3");
    expect(nextSurfaceName(["Surface 2"])).toBe("Surface 1");
  });

  it("matches case-insensitively and ignores whitespace", () => {
    expect(nextSurfaceName(["  surface 1 ", "SURFACE 2"])).toBe("Surface 3");
  });

  it("ignores custom names", () => {
    expect(nextSurfaceName(["Driveway", "Back patio"])).toBe("Surface 1");
  });
});

describe("parsePitchInput", () => {
  it("accepts whole rises 1–24", () => {
    expect(parsePitchInput("6")).toEqual({ ok: true, value: 6 });
    expect(parsePitchInput(" 24 ")).toEqual({ ok: true, value: 24 });
    expect(parsePitchInput("1")).toEqual({ ok: true, value: 1 });
  });

  it("rejects empty, non-numeric, fractional, and out-of-range input", () => {
    expect(parsePitchInput("").ok).toBe(false);
    expect(parsePitchInput("steep").ok).toBe(false);
    expect(parsePitchInput("6.5").ok).toBe(false);
    expect(parsePitchInput("0").ok).toBe(false);
    expect(parsePitchInput("25").ok).toBe(false);
  });
});
