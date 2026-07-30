import type { NormalizedGeometry } from "./normalized-geometry";
import { polygonArea, polygonPerimeter } from "./normalized-geometry";

// SI -> imperial. Exact conversion constants (never round these, only the final values).
const SQ_METERS_TO_SQFT = 10.763910417;
const METERS_TO_FEET = 3.280839895;

export type PaintingQuantityKind =
  | "walls_sqft"
  | "ceiling_sqft"
  | "baseboard_lnft"
  | "crown_lnft"
  | "doors_count"
  | "windows_count";

export interface PaintingQuantity {
  readonly kind: PaintingQuantityKind;
  readonly value: number | null;
  readonly status: "derived" | "needs_confirm";
}

const MIN_WALL_POLYGON_VERTICES = 3;

const round1 = (n: number): number => Math.round(n * 10) / 10;

/**
 * Pure derivation of painting quantities from captured geometry. Laws (binding, do not change
 * without re-reading the phase-1 plan):
 *  - walls are GROSS — openings are never deducted from wall area.
 *  - a null/vaulted ceiling never gets a guessed value — it comes back needs_confirm.
 *  - ANY degenerate wall polygon (< 3 vertices) sends walls_sqft to needs_confirm — summing
 *    only the usable walls guarantees an undercount presented as a confident number. (Owen's
 *    first real scan had 14 of 15 walls come back empty from RoomPlan: 26 sqft "derived" for
 *    a room that was really ~600.) A room with zero walls is the same law.
 *  - baseboard deducts only door widths (not windows), and is floored at 0.
 *  - crown uses the flat-ceiling convention: ceiling perimeter === floor perimeter.
 *  - 'opening' kind counts as neither a door nor a window.
 */
export function derivePaintingQuantities(g: NormalizedGeometry): PaintingQuantity[] {
  const floorPerimeterM = polygonPerimeter(g.floorPolygon.vertices);

  const usableWalls = g.walls.filter((wall) => wall.polygon.vertices.length >= MIN_WALL_POLYGON_VERTICES);
  const wallsNeedConfirm = usableWalls.length === 0 || usableWalls.length < g.walls.length;
  const wallsAreaM2 = usableWalls.reduce((sum, wall) => sum + polygonArea(wall.polygon.vertices), 0);
  const wallsSqft = wallsNeedConfirm ? null : round1(wallsAreaM2 * SQ_METERS_TO_SQFT);

  const ceilingNeedsConfirm = g.ceiling === null || g.ceiling.isVaulted || g.ceiling.area === null;
  const ceilingSqft = ceilingNeedsConfirm ? null : round1((g.ceiling as { area: number }).area * SQ_METERS_TO_SQFT);

  const doorWidthSumM = g.openings
    .filter((o) => o.kind === "door")
    .reduce((sum, o) => sum + o.width, 0);
  const baseboardM = Math.max(0, floorPerimeterM - doorWidthSumM);
  const baseboardLnft = round1(baseboardM * METERS_TO_FEET);

  // Flat-ceiling convention: crown molding runs the same perimeter as the floor.
  const crownLnft = round1(floorPerimeterM * METERS_TO_FEET);

  const doorsCount = g.openings.filter((o) => o.kind === "door").length;
  const windowsCount = g.openings.filter((o) => o.kind === "window").length;

  return [
    { kind: "walls_sqft", value: wallsSqft, status: wallsNeedConfirm ? "needs_confirm" : "derived" },
    { kind: "ceiling_sqft", value: ceilingSqft, status: ceilingNeedsConfirm ? "needs_confirm" : "derived" },
    { kind: "baseboard_lnft", value: baseboardLnft, status: "derived" },
    { kind: "crown_lnft", value: crownLnft, status: "derived" },
    { kind: "doors_count", value: doorsCount, status: "derived" },
    { kind: "windows_count", value: windowsCount, status: "derived" },
  ];
}
