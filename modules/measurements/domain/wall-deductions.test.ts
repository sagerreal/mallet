import { describe, it, expect } from "vitest";
import type { NormalizedGeometry, Point3 } from "./normalized-geometry";
import {
  wallDimensions,
  deriveDeductionSqft,
  netWallsSqft,
  type Deduction,
} from "./wall-deductions";

// A vertical rectangular wall spanning the X axis: w metres wide, h metres tall, at depth z.
const wall = (w: number, h: number, z = 0): { polygon: { vertices: Point3[] } } => ({
  polygon: {
    vertices: [
      { x: 0, y: 0, z },
      { x: w, y: 0, z },
      { x: w, y: h, z },
      { x: 0, y: h, z },
    ],
  },
});

const geometry = (walls: ReturnType<typeof wall>[]): NormalizedGeometry => ({
  floorPolygon: { vertices: [] },
  walls,
  openings: [],
  ceiling: null,
});

const SQFT_PER_SQM = 10.763910417;
/** Every painting quantity is reported to 1dp — assert against that contract, not raw floats. */
const sqft = (m2: number): number => Math.round(m2 * SQFT_PER_SQM * 10) / 10;

describe("wallDimensions", () => {
  it("reads width and height off a vertical rectangle", () => {
    const d = wallDimensions(wall(3, 2.4));
    expect(d.widthM).toBeCloseTo(3, 6);
    expect(d.heightM).toBeCloseTo(2.4, 6);
    expect(d.areaM2).toBeCloseTo(7.2, 6);
  });

  // A wall on any bearing, not just axis-aligned — RoomPlan returns rooms in their own frame.
  it("measures width in the wall's own plane, not along X", () => {
    const diagonal = {
      polygon: {
        vertices: [
          { x: 0, y: 0, z: 0 },
          { x: 3, y: 0, z: 4 }, // 5m run in XZ
          { x: 3, y: 2.4, z: 4 },
          { x: 0, y: 2.4, z: 0 },
        ],
      },
    };
    const d = wallDimensions(diagonal);
    expect(d.widthM).toBeCloseTo(5, 6);
    expect(d.heightM).toBeCloseTo(2.4, 6);
  });

  it("returns zeroes for a degenerate polygon rather than NaN", () => {
    const d = wallDimensions({ polygon: { vertices: [{ x: 0, y: 0, z: 0 }] } });
    expect(d).toEqual({ widthM: 0, heightM: 0, areaM2: 0 });
  });
});

describe("deriveDeductionSqft — whole wall", () => {
  const g = geometry([wall(3, 2.4), wall(4, 2.4, 1), wall(3, 2.4, 2)]);

  it("subtracts the full area of each selected wall", () => {
    const d: Deduction = { kind: "whole_wall", wallIndexes: [1], heightM: null };
    expect(deriveDeductionSqft(g, d)).toBe(sqft(4 * 2.4));
  });

  it("sums across several selected walls", () => {
    const d: Deduction = { kind: "whole_wall", wallIndexes: [0, 2], heightM: null };
    expect(deriveDeductionSqft(g, d)).toBe(sqft(2 * (3 * 2.4)));
  });

  // The client sends indexes; a stale one must not silently price as zero-and-fine, nor throw.
  it("ignores an index that is not in this geometry", () => {
    const d: Deduction = { kind: "whole_wall", wallIndexes: [0, 99], heightM: null };
    expect(deriveDeductionSqft(g, d)).toBe(sqft(3 * 2.4));
  });

  it("counts a wall named twice only once", () => {
    const d: Deduction = { kind: "whole_wall", wallIndexes: [0, 0], heightM: null };
    expect(deriveDeductionSqft(g, d)).toBe(sqft(3 * 2.4));
  });

  it("is zero when nothing is selected", () => {
    expect(deriveDeductionSqft(g, { kind: "whole_wall", wallIndexes: [], heightM: null })).toBe(0);
  });
});

describe("deriveDeductionSqft — band (the tile wainscot)", () => {
  // 3m and 4m walls, both 2.4m tall. A 1.2m band takes half of each.
  const g = geometry([wall(3, 2.4), wall(4, 2.4, 1)]);

  it("takes width x height off each selected wall", () => {
    const d: Deduction = { kind: "band", wallIndexes: [0, 1], heightM: 1.2 };
    expect(deriveDeductionSqft(g, d)).toBe(sqft((3 + 4) * 1.2));
  });

  // The whole point of the feature: the painter picks a height, never a width.
  it("uses the scan's own widths, so only the height is an input", () => {
    const d: Deduction = { kind: "band", wallIndexes: [1], heightM: 1.2 };
    expect(deriveDeductionSqft(g, d)).toBe(sqft(4 * 1.2));
  });

  // A band taller than the wall is a full-wall deduction, not an over-subtraction that
  // drives the room negative.
  it("clamps a band taller than the wall to the wall's own height", () => {
    const d: Deduction = { kind: "band", wallIndexes: [0], heightM: 99 };
    expect(deriveDeductionSqft(g, d)).toBe(sqft(3 * 2.4));
  });

  it("clamps each wall independently when they differ in height", () => {
    const mixed = geometry([wall(3, 2.4), wall(4, 1.0, 1)]);
    const d: Deduction = { kind: "band", wallIndexes: [0, 1], heightM: 1.2 };
    // 3m x 1.2 (fits) + 4m x 1.0 (clamped)
    expect(deriveDeductionSqft(mixed, d)).toBe(sqft(3 * 1.2 + 4 * 1.0));
  });

  it("is null for a band with no height — an unanswerable deduction, not a zero one", () => {
    expect(deriveDeductionSqft(g, { kind: "band", wallIndexes: [0], heightM: null })).toBeNull();
  });

  it("is zero for a zero-height band", () => {
    expect(deriveDeductionSqft(g, { kind: "band", wallIndexes: [0], heightM: 0 })).toBe(0);
  });
});

describe("netWallsSqft", () => {
  it("subtracts every deduction from the gross", () => {
    expect(netWallsSqft(420, [96, 24])).toBe(300);
  });

  it("leaves the gross alone when nothing is deducted", () => {
    expect(netWallsSqft(420, [])).toBe(420);
  });

  // A room cannot have negative paintable wall. Over-deduction is a data problem to show,
  // never a negative number to price.
  it("floors at zero rather than going negative", () => {
    expect(netWallsSqft(100, [80, 80])).toBe(0);
  });

  // walls_sqft is null while it is needs_confirm — there is no gross to subtract from, and
  // inventing 0 would present an unmeasured room as fully deducted.
  it("stays null when there is no gross to subtract from", () => {
    expect(netWallsSqft(null, [96])).toBeNull();
  });

  it("ignores a deduction whose own area could not be derived", () => {
    expect(netWallsSqft(420, [96, null])).toBe(324);
  });

  it("rounds to one decimal, matching every other painting quantity", () => {
    expect(netWallsSqft(100, [33.333])).toBe(66.7);
  });
});
