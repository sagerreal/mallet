import { describe, it, expect } from "vitest";
import type { NormalizedGeometry, Point3 } from "./normalized-geometry";
import {
  roomUp,
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

// ---------------------------------------------------------------------------
// THE FRAME IS NOT OURS TO ASSUME. Owen's real bathroom capture (Aug 18) arrived Z-UP: every
// wall's z-extent was exactly 2.31 m — the ceiling height — and y was a horizontal direction.
// wallDimensions assumed y-up, so it printed a wall's horizontal component as its "height" and a
// diagonal mixing vertical as its "width": the room card read "Wall 2 · 12' 4" × 1' 6" ·
// 74.3 sq ft", a contradiction on its face (12.3 × 1.5 ≠ 74.3). Areas were always right —
// Newell's method is frame-free — which is exactly what made the wrong dims visible.
//
// The room itself says which way is up: the FLOOR's normal. So callers derive up from the floor
// (roomUp) and hand it in; the y-up default remains for geometry with no usable floor.
// ---------------------------------------------------------------------------

// Wall 2 of the real capture, verbatim: a vertical rectangle in a z-up frame,
// 2.99 m of horizontal run, 2.31 m floor-to-ceiling.
const Z_UP_WALL = {
  polygon: {
    vertices: [
      { x: 1.64, y: -1.36, z: -1.26 },
      { x: -1.31, y: -0.91, z: -1.26 },
      { x: -1.31, y: -0.91, z: 1.05 },
      { x: 1.64, y: -1.36, z: 1.05 },
    ],
  },
};
const Z_UP = { x: 0, y: 0, z: 1 };
const Y_UP = { x: 0, y: 1, z: 0 };

describe("wallDimensions with an explicit up direction", () => {
  it("reads a z-up wall's real height and width (the Aug 18 bathroom wall)", () => {
    const d = wallDimensions(Z_UP_WALL, Z_UP);

    expect(d.heightM).toBeCloseTo(2.31, 2);
    expect(d.widthM).toBeCloseTo(2.98, 1);
    // The audit invariant: printed width × printed height ≈ printed area, for a rectangle.
    expect(d.widthM * d.heightM).toBeCloseTo(d.areaM2, 1);
  });

  it("keeps a y-up wall exactly as before when up is y (regression)", () => {
    const d = wallDimensions(wall(3, 2.4), Y_UP);

    expect(d.widthM).toBeCloseTo(3, 5);
    expect(d.heightM).toBeCloseTo(2.4, 5);
  });

  it("defaults to y-up when no up is given — existing callers unchanged", () => {
    const d = wallDimensions(wall(3, 2.4));

    expect(d.heightM).toBeCloseTo(2.4, 5);
  });
});

describe("roomUp — the floor answers which way is up", () => {
  it("returns the z axis for a z-up floor", () => {
    const up = roomUp({
      floorPolygon: { vertices: [{ x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }, { x: 3, y: 2, z: 0 }, { x: 0, y: 2, z: 0 }] },
      walls: [],
      openings: [],
      ceiling: null,
    });

    expect(Math.abs(up.z)).toBeCloseTo(1, 5);
    expect(Math.abs(up.y)).toBeCloseTo(0, 5);
  });

  it("returns the y axis for a y-up floor", () => {
    const up = roomUp({
      floorPolygon: { vertices: [{ x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }, { x: 3, y: 0, z: 2 }, { x: 0, y: 0, z: 2 }] },
      walls: [],
      openings: [],
      ceiling: null,
    });

    expect(Math.abs(up.y)).toBeCloseTo(1, 5);
  });

  it("falls back to y-up when the floor is degenerate — the old behaviour, not a crash", () => {
    const up = roomUp({ floorPolygon: { vertices: [] }, walls: [], openings: [], ceiling: null });

    expect(up).toEqual({ x: 0, y: 1, z: 0 });
  });
});

describe("band deductions in a z-up room", () => {
  // The same broken height poisoned wainscot math: a 1.22 m band clamped against a "1'6" wall"
  // deducted the ENTIRE wall. With the floor-derived up it deducts band × width, as tiled.
  it("clamps the band against the wall's real height, not a horizontal component", () => {
    const g = {
      floorPolygon: { vertices: [{ x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }, { x: 3, y: 2, z: 0 }, { x: 0, y: 2, z: 0 }] },
      walls: [Z_UP_WALL],
      openings: [],
      ceiling: null,
    };
    const band = { id: "d1", reason: "Tile wainscot", kind: "band" as const, wallIndexes: [0], heightM: 1.22 };

    // 2.98 m wide × 1.22 m band = 3.64 m² ≈ 39.2 sq ft — NOT the whole 74.3 sq ft wall.
    expect(deriveDeductionSqft(g, band)).toBeCloseTo(39.2, 0);
  });
});


describe("band deductions on non-rectangular walls", () => {
  // width × band-height is a rectangle's band. A gable wall's bounding box (4 × 3.2 m) holds
  // MORE area than the wall (11.02 m²), so an uncapped full-height band deducted 137.8 sq ft
  // from a 118.6 sq ft wall — removing area the room does not have.
  it("never deducts more than the wall's own area", () => {
    const gable = {
      polygon: {
        vertices: [
          { x: 0, y: 0, z: 0 },
          { x: 4, y: 0, z: 0 },
          { x: 4, y: 2.31, z: 0 },
          { x: 2, y: 3.2, z: 0 },
          { x: 0, y: 2.31, z: 0 },
        ],
      },
    };
    const g: NormalizedGeometry = {
      floorPolygon: { vertices: [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, { x: 4, y: 0, z: 3 }, { x: 0, y: 0, z: 3 }] },
      walls: [gable],
      openings: [],
      ceiling: null,
    };
    const band: Deduction = { kind: "band", wallIndexes: [0], heightM: 5 };
    const whole: Deduction = { kind: "whole_wall", wallIndexes: [0], heightM: null };

    expect(deriveDeductionSqft(g, band)).toBe(deriveDeductionSqft(g, whole));
    expect(deriveDeductionSqft(g, band)).toBeCloseTo(118.6, 0);
  });
});

describe("roomUp on a numerically-degenerate floor", () => {
  // Exact `=== 0` let a sliver floor's noise normal (length ~1e-9) become "up", transposing
  // every wall's dims. The magnitude of the Newell normal is 2× the floor's area, and 0.01 m²
  // of floor is no floor.
  it("falls back to y-up rather than normalizing noise", () => {
    const up = roomUp({
      floorPolygon: { vertices: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 1e-9 }, { x: 0, y: 2, z: 0 }] },
      walls: [],
      openings: [],
      ceiling: null,
    });

    expect(up).toEqual({ x: 0, y: 1, z: 0 });
  });
});
