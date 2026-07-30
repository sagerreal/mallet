import { describe, it, expect } from "vitest";
import { derivePaintingQuantities, type PaintingQuantity } from "./derive-painting";
import type { NormalizedGeometry } from "./normalized-geometry";

// 4m x 3m x 2.4m room. Floor area 12 m^2, perimeter 14 m. Four vertical wall rectangles whose
// combined area is 14 * 2.4 = 33.6 m^2 (hand-verified against the Newell's-method port).
const room4x3x2p4 = (overrides: Partial<NormalizedGeometry> = {}): NormalizedGeometry => ({
  floorPolygon: {
    vertices: [
      { x: 0, y: 0, z: 0 },
      { x: 4, y: 0, z: 0 },
      { x: 4, y: 0, z: 3 },
      { x: 0, y: 0, z: 3 },
    ],
  },
  walls: [
    { polygon: { vertices: [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, { x: 4, y: 2.4, z: 0 }, { x: 0, y: 2.4, z: 0 }] } },
    { polygon: { vertices: [{ x: 4, y: 0, z: 0 }, { x: 4, y: 0, z: 3 }, { x: 4, y: 2.4, z: 3 }, { x: 4, y: 2.4, z: 0 }] } },
    { polygon: { vertices: [{ x: 4, y: 0, z: 3 }, { x: 0, y: 0, z: 3 }, { x: 0, y: 2.4, z: 3 }, { x: 4, y: 2.4, z: 3 }] } },
    { polygon: { vertices: [{ x: 0, y: 0, z: 3 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 2.4, z: 0 }, { x: 0, y: 2.4, z: 3 }] } },
  ],
  openings: [
    { kind: "door", width: 0.9, height: 2.0, wallIndex: 0 },
    { kind: "window", width: 1.2, height: 1.0, wallIndex: 1 },
  ],
  ceiling: { area: 12, isVaulted: false, wallTopSpread: 0, provenance: "roomplan" },
  ...overrides,
});

const findQuantity = (qs: PaintingQuantity[], kind: PaintingQuantity["kind"]): PaintingQuantity => {
  const q = qs.find((x) => x.kind === kind);
  if (!q) throw new Error(`missing quantity: ${kind}`);
  return q;
};

describe("derivePaintingQuantities", () => {
  it("derives all quantities for a standard room (hand-verified numbers)", () => {
    const qs = derivePaintingQuantities(room4x3x2p4());

    // Walls are GROSS: 33.6 m^2 * 10.763910417 = 361.6673900112 -> 361.7. Openings never deducted.
    expect(findQuantity(qs, "walls_sqft")).toEqual({ kind: "walls_sqft", value: 361.7, status: "derived" });

    // Ceiling: 12 m^2 * 10.763910417 = 129.166925004 -> 129.2.
    expect(findQuantity(qs, "ceiling_sqft")).toEqual({ kind: "ceiling_sqft", value: 129.2, status: "derived" });

    // Baseboard: (14 - 0.9 door width) * 3.280839895 = 13.1 * 3.280839895 = 42.9790026245 -> 43.0.
    expect(findQuantity(qs, "baseboard_lnft")).toEqual({ kind: "baseboard_lnft", value: 43.0, status: "derived" });

    // Crown: flat convention, ceiling perimeter = floor perimeter = 14 m.
    // 14 * 3.280839895 = 45.93175853 -> 45.9.
    expect(findQuantity(qs, "crown_lnft")).toEqual({ kind: "crown_lnft", value: 45.9, status: "derived" });

    expect(findQuantity(qs, "doors_count")).toEqual({ kind: "doors_count", value: 1, status: "derived" });
    expect(findQuantity(qs, "windows_count")).toEqual({ kind: "windows_count", value: 1, status: "derived" });
  });

  it("never deducts opening area from gross wall area, even with many large openings", () => {
    const g = room4x3x2p4({
      openings: [
        { kind: "door", width: 0.9, height: 2.0, wallIndex: 0 },
        { kind: "door", width: 0.9, height: 2.0, wallIndex: 1 },
        { kind: "window", width: 2.0, height: 1.5, wallIndex: 2 },
      ],
    });
    expect(findQuantity(derivePaintingQuantities(g), "walls_sqft").value).toBe(361.7);
  });

  it("returns needs_confirm with a null value for a vaulted ceiling", () => {
    const g = room4x3x2p4({ ceiling: { area: 12, isVaulted: true, wallTopSpread: null, provenance: "roomplan" } });
    expect(findQuantity(derivePaintingQuantities(g), "ceiling_sqft")).toEqual({
      kind: "ceiling_sqft",
      value: null,
      status: "needs_confirm",
    });
  });

  it("returns needs_confirm with a null value for a null ceiling", () => {
    const g = room4x3x2p4({ ceiling: null });
    expect(findQuantity(derivePaintingQuantities(g), "ceiling_sqft")).toEqual({
      kind: "ceiling_sqft",
      value: null,
      status: "needs_confirm",
    });
  });

  it("returns needs_confirm with a null value when ceiling.area is null", () => {
    const g = room4x3x2p4({ ceiling: { area: null, isVaulted: false, wallTopSpread: 0, provenance: "roomplan" } });
    expect(findQuantity(derivePaintingQuantities(g), "ceiling_sqft")).toEqual({
      kind: "ceiling_sqft",
      value: null,
      status: "needs_confirm",
    });
  });

  it("floors baseboard at 0 when door widths exceed the floor perimeter", () => {
    const g = room4x3x2p4({
      openings: [{ kind: "door", width: 999, height: 2.0, wallIndex: 0 }],
    });
    expect(findQuantity(derivePaintingQuantities(g), "baseboard_lnft").value).toBe(0);
  });

  it("does not deduct window widths from baseboard, only doors", () => {
    const g = room4x3x2p4({
      openings: [{ kind: "window", width: 5, height: 1.0, wallIndex: 0 }],
    });
    // No doors: baseboard = full 14m perimeter * 3.280839895 = 45.93175853 -> 45.9.
    expect(findQuantity(derivePaintingQuantities(g), "baseboard_lnft").value).toBe(45.9);
  });

  it("returns walls_sqft needs_confirm/null when there are no wall polygons, but still derives baseboard/crown from the floor", () => {
    const g = room4x3x2p4({ walls: [] });
    const qs = derivePaintingQuantities(g);
    expect(findQuantity(qs, "walls_sqft")).toEqual({ kind: "walls_sqft", value: null, status: "needs_confirm" });
    // Floor polygon is schema-required, so perimeter-derived quantities stay meaningful even
    // with zero usable walls.
    expect(findQuantity(qs, "baseboard_lnft")).toEqual({ kind: "baseboard_lnft", value: 43.0, status: "derived" });
    expect(findQuantity(qs, "crown_lnft")).toEqual({ kind: "crown_lnft", value: 45.9, status: "derived" });
  });

  it("returns walls_sqft needs_confirm/null when every wall polygon is degenerate (< 3 vertices)", () => {
    const g = room4x3x2p4({
      walls: [
        { polygon: { vertices: [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }] } },
        { polygon: { vertices: [{ x: 4, y: 0, z: 0 }] } },
      ],
    });
    expect(findQuantity(derivePaintingQuantities(g), "walls_sqft")).toEqual({
      kind: "walls_sqft",
      value: null,
      status: "needs_confirm",
    });
  });

  it("returns walls_sqft needs_confirm when even ONE wall polygon is degenerate — a partial sum is a guaranteed undercount", () => {
    // Owen's first real scan: 14 of 15 walls came back with empty polygons from RoomPlan,
    // and the single usable wall produced a confident 26.4 sqft for a ~600 sqft room.
    const g = room4x3x2p4();
    const withOneEmpty = { ...g, walls: [...g.walls, { polygon: { vertices: [] } }] };
    expect(findQuantity(derivePaintingQuantities(withOneEmpty), "walls_sqft")).toEqual({
      kind: "walls_sqft",
      value: null,
      status: "needs_confirm",
    });
  });

  it("rounds only at the end (13.9498m perimeter -> 45.8 lnft, not 45.9 which intermediate meter-rounding would give)", () => {
    // 4 x 2.9749m floor: perimeter = 2*(4 + 2.9749) = 13.9498m exactly.
    // Correct: round1(13.9498 * 3.280839895) = round1(45.767060367...) = 45.8.
    // Wrong (rounds meters to the nearest whole meter first, i.e. 14m): round1(14 * 3.280839895)
    // = round1(45.93175853) = 45.9 — a different, wrong, answer. This test fails if intermediate
    // rounding creeps in anywhere before the final round-to-1-decimal step.
    const g = room4x3x2p4({
      floorPolygon: {
        vertices: [
          { x: 0, y: 0, z: 0 },
          { x: 4, y: 0, z: 0 },
          { x: 4, y: 0, z: 2.9749 },
          { x: 0, y: 0, z: 2.9749 },
        ],
      },
      openings: [],
    });
    expect(findQuantity(derivePaintingQuantities(g), "crown_lnft").value).toBe(45.8);
    expect(findQuantity(derivePaintingQuantities(g), "baseboard_lnft").value).toBe(45.8);
  });

  it("counts 'opening' kind as neither a door nor a window", () => {
    const g = room4x3x2p4({
      openings: [
        { kind: "door", width: 0.9, height: 2.0, wallIndex: 0 },
        { kind: "opening", width: 1.5, height: 2.4, wallIndex: 1 },
      ],
    });
    const qs = derivePaintingQuantities(g);
    expect(findQuantity(qs, "doors_count").value).toBe(1);
    expect(findQuantity(qs, "windows_count").value).toBe(0);
  });
});
