import { describe, it, expect } from "vitest";
// Test files are exempt from the deep-import boundary lint rule (eslint.config's
// "**/*.test.{ts,tsx}" override) — this is the one place allowed to reach past the
// measurements barrel, specifically to pin service.ts's re-declared union against the
// measurements module's actual source of truth.
import { derivePaintingQuantities } from "@mallet/measurements/domain/derive-painting";
import type { NormalizedGeometry } from "@mallet/measurements/domain/normalized-geometry";
import { MEASURED_BY_KINDS } from "./service";

// Minimal-but-valid geometry — derivePaintingQuantities always emits exactly one entry per
// PaintingQuantityKind regardless of input (only the value/status vary), so this is enough to
// enumerate the full kind set without depending on measurement capture fixtures.
const EMPTY_GEOMETRY: NormalizedGeometry = {
  floorPolygon: { vertices: [] },
  walls: [],
  openings: [],
  ceiling: null,
};

describe("MEASURED_BY_KINDS pinning", () => {
  it("stays in exact sync with measurements' PaintingQuantityKind", () => {
    const measurementsKinds = derivePaintingQuantities(EMPTY_GEOMETRY)
      .map((q) => q.kind)
      .sort();
    const pricebookKinds = [...MEASURED_BY_KINDS].sort();
    expect(pricebookKinds).toEqual(measurementsKinds);
  });

  it("has no duplicates", () => {
    // The COUNT is deliberately not hard-coded: the test above already pins membership against the
    // derivation, so a literal here only ever goes stale when a kind is legitimately added (it did,
    // when soffit_sqft landed). What this still has to catch is a kind listed twice.
    expect(new Set(MEASURED_BY_KINDS).size).toBe(MEASURED_BY_KINDS.length);
  });

  it("includes soffit_sqft — the one kind that can never be derived", () => {
    // Named explicitly because it is the exception the whole set has to tolerate: RoomPlan reports
    // walls, the floor and openings, so a boxed soffit arrives as nothing at all and is priced only
    // from a number the painter enters.
    expect(MEASURED_BY_KINDS).toContain("soffit_sqft");
  });
});
