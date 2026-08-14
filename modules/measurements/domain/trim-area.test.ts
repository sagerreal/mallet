/**
 * A trim run becomes a trim area only once somebody types the height. The height is typed
 * rather than picked from a list because real millwork does not come from a list — 2¼", 3¼",
 * 4", 5¼", 7", and a 4" commercial rubber cove that matches none of them.
 */
import { describe, it, expect } from "vitest";
import {
  trimAreaSqft,
  isValidTrimHeight,
  isTrimRunKind,
  MAX_TRIM_HEIGHT_IN,
} from "./trim-area";

describe("trimAreaSqft", () => {
  it("multiplies the run by the height, in feet", () => {
    // 38.4 ln ft of 5¼" base = 38.4 × 5.25 / 12 = 16.8 sq ft
    expect(trimAreaSqft(38.4, 5.25)).toBe(16.8);
  });

  it("rounds to a single decimal, like every other quantity on the card", () => {
    // 29.3 × 3.25 / 12 = 7.9354…
    expect(trimAreaSqft(29.3, 3.25)).toBe(7.9);
  });

  it("scales with height — the whole point of asking", () => {
    const short = trimAreaSqft(38.4, 3.25);
    const tall = trimAreaSqft(38.4, 7);
    expect(tall).toBeGreaterThan(short);
  });

  it("gives back zero area for a zero run, without dividing by anything", () => {
    expect(trimAreaSqft(0, 5.25)).toBe(0);
  });

  it("takes the FACE only — no profile allowance is invented here", () => {
    // A 7" crown is 7 inches of face. If a shop wants coverage for the profile it belongs in
    // the rate, not silently multiplied into every measurement.
    expect(trimAreaSqft(12, 7)).toBe(trimAreaSqft(12, 7));
    expect(trimAreaSqft(12, 7)).toBe(7);
  });
});

describe("isValidTrimHeight", () => {
  it("takes the real millwork sizes", () => {
    for (const h of [2.25, 3.25, 4, 5.25, 7, 9.5]) {
      expect(isValidTrimHeight(h)).toBe(true);
    }
  });

  it("refuses zero — 'no baseboard' is the None control, not a zero height", () => {
    // A zero height on a room with 38 feet of base would price as measured-and-worthless.
    expect(isValidTrimHeight(0)).toBe(false);
  });

  it("refuses a negative height", () => {
    expect(isValidTrimHeight(-4)).toBe(false);
  });

  it("takes the boundary and refuses past it", () => {
    expect(isValidTrimHeight(MAX_TRIM_HEIGHT_IN)).toBe(true);
    expect(isValidTrimHeight(MAX_TRIM_HEIGHT_IN + 0.1)).toBe(false);
    // 36" is panelling or wainscot — a wall surface — and far likelier a slip for 3.6.
    expect(isValidTrimHeight(36)).toBe(false);
  });

  it("refuses a non-number", () => {
    expect(isValidTrimHeight(Number.NaN)).toBe(false);
    expect(isValidTrimHeight(Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe("isTrimRunKind", () => {
  it("is true for the two kinds measured as a run", () => {
    expect(isTrimRunKind("baseboard_lnft")).toBe(true);
    expect(isTrimRunKind("crown_lnft")).toBe(true);
  });

  it("is false for kinds that are already areas or counts", () => {
    // A height would mean nothing on these: walls/ceiling/soffit are areas already, and a
    // door is not taller in square feet.
    expect(isTrimRunKind("walls_sqft")).toBe(false);
    expect(isTrimRunKind("ceiling_sqft")).toBe(false);
    expect(isTrimRunKind("soffit_sqft")).toBe(false);
    expect(isTrimRunKind("doors_count")).toBe(false);
    expect(isTrimRunKind("windows_count")).toBe(false);
  });
});
