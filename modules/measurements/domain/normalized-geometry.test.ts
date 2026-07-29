import { describe, it, expect } from "vitest";
import { isOk, isErr } from "@mallet/shared/types";
import { parseNormalizedGeometry, polygonArea, polygonPerimeter, type Point3 } from "./normalized-geometry";

// A flat 4x3m rectangle in the y=0 (floor) plane.
const floorVertices: Point3[] = [
  { x: 0, y: 0, z: 0 },
  { x: 4, y: 0, z: 0 },
  { x: 4, y: 0, z: 3 },
  { x: 0, y: 0, z: 3 },
];

const validWirePayload = {
  floor_polygon: { vertices: floorVertices },
  walls: [
    { polygon: { vertices: [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, { x: 4, y: 2.4, z: 0 }, { x: 0, y: 2.4, z: 0 }] } },
  ],
  openings: [{ kind: "door", width: 0.9, height: 2.0 }],
  ceiling: { area: 12, is_vaulted: false, wall_top_spread: 0, provenance: "roomplan" },
};

describe("parseNormalizedGeometry", () => {
  it("parses a valid wire payload into camelCase domain shape", () => {
    const r = parseNormalizedGeometry(validWirePayload);
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect(r.value.floorPolygon.vertices).toHaveLength(4);
    expect(r.value.walls).toHaveLength(1);
    expect(r.value.openings[0]).toEqual({ kind: "door", width: 0.9, height: 2.0, wallIndex: null });
    expect(r.value.ceiling).toEqual({ area: 12, isVaulted: false, wallTopSpread: 0, provenance: "roomplan" });
  });

  it("accepts an explicit null wall_index on an opening (non-Swift producers may send null)", () => {
    const r = parseNormalizedGeometry({
      ...validWirePayload,
      openings: [{ kind: "door", width: 0.9, height: 2.0, wall_index: null }],
    });
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value.openings[0]?.wallIndex).toBeNull();
  });

  it("accepts a null ceiling", () => {
    const r = parseNormalizedGeometry({ ...validWirePayload, ceiling: null });
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect(r.value.ceiling).toBeNull();
  });

  it("rejects NaN coordinates", () => {
    const r = parseNormalizedGeometry({
      ...validWirePayload,
      floor_polygon: { vertices: [{ x: NaN, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, { x: 4, y: 0, z: 3 }] },
    });
    expect(isErr(r)).toBe(true);
  });

  it("rejects a negative opening width", () => {
    const r = parseNormalizedGeometry({
      ...validWirePayload,
      openings: [{ kind: "door", width: -1, height: 2.0 }],
    });
    expect(isErr(r)).toBe(true);
  });

  it("rejects an absent floor_polygon", () => {
    const { floor_polygon: _drop, ...withoutFloor } = validWirePayload;
    const r = parseNormalizedGeometry(withoutFloor);
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.kind).toBe("validation");
  });

  it("rejects a degenerate floor (< 3 vertices)", () => {
    const r = parseNormalizedGeometry({
      ...validWirePayload,
      floor_polygon: { vertices: [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }] },
    });
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.field).toBe("floor_polygon.vertices");
  });
});

describe("polygonArea (Newell's method)", () => {
  it("computes the area of a flat rectangle", () => {
    expect(polygonArea(floorVertices)).toBeCloseTo(12, 9);
  });

  it("is plane-true for a tilted rectangle (area unaffected by orientation)", () => {
    // Same 4x3 rectangle, rotated so it lies in the x-y plane at z=5 instead of the y=0 plane.
    const tilted: Point3[] = [
      { x: 0, y: 0, z: 5 },
      { x: 4, y: 0, z: 5 },
      { x: 4, y: 3, z: 5 },
      { x: 0, y: 3, z: 5 },
    ];
    expect(polygonArea(tilted)).toBeCloseTo(12, 9);
  });

  it("returns 0 for fewer than 3 vertices", () => {
    expect(polygonArea([])).toBe(0);
    expect(polygonArea([{ x: 0, y: 0, z: 0 }])).toBe(0);
    expect(polygonArea([{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }])).toBe(0);
  });
});

describe("polygonPerimeter", () => {
  it("computes the closed-loop perimeter of a rectangle", () => {
    expect(polygonPerimeter(floorVertices)).toBeCloseTo(14, 9);
  });

  it("returns 0 for fewer than 2 vertices", () => {
    expect(polygonPerimeter([])).toBe(0);
    expect(polygonPerimeter([{ x: 0, y: 0, z: 0 }])).toBe(0);
  });
});
