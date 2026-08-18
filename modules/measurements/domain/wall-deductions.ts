/**
 * modules/measurements/domain/wall-deductions.ts
 * Wall area a room does NOT get painted, derived from the scan the painter already took.
 *
 * WHY THIS EXISTS. `derive-painting.ts` reports walls GROSS on purpose — openings are never
 * deducted, because you still cut in around a window and the cutting is the expensive part. Tile
 * is the opposite: a continuous band nobody paints and nobody cuts around. Before this, the only
 * way to price a tiled bathroom was to override walls_sqft with a number worked out by hand, which
 * lost the reason — six weeks later nobody knows whether 420 became 324 for tile, a mistake, or a
 * discount.
 *
 * THE PAINTER NEVER MEASURES. Every width here comes out of the capture: a RoomPlan wall is its own
 * polygon, so its width, height and area are already known. Selecting walls is a tap, and the only
 * typed input in the whole feature is a band's height — which is a preset, not a tape reading.
 *
 * NOT MIRRORS, and not by omission. A mirror is a thing you mask and cut around, exactly like the
 * window beside it, so deducting one would both understate the paint and hide the labour. The rule
 * this file implements is: deduct what you neither paint nor cut around. (RoomPlan has no mirror
 * category either — but the convention is the reason, not the limitation.)
 *
 * PURE. The server derives every square foot from stored inputs; the client never sends an area.
 * Same law as site_captures.areaSqft.
 */

import type { NormalizedGeometry, Point3 } from "./normalized-geometry";
import { polygonArea } from "./normalized-geometry";

const SQ_METERS_TO_SQFT = 10.763910417;
const MIN_POLYGON_VERTICES = 3;

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** What a deduction takes off: a whole wall, or a band of fixed height across selected walls. */
export type DeductionKind = "whole_wall" | "band";

export interface Deduction {
  readonly kind: DeductionKind;
  /** Indexes into NormalizedGeometry.walls. Order-insensitive; duplicates count once. */
  readonly wallIndexes: readonly number[];
  /** Band height in metres. Always null for whole_wall; required for band. */
  readonly heightM: number | null;
}

export interface WallDimensions {
  readonly widthM: number;
  readonly heightM: number;
  readonly areaM2: number;
}

const ZERO: WallDimensions = { widthM: 0, heightM: 0, areaM2: 0 };

const Y_UP: Point3 = { x: 0, y: 1, z: 0 };

/**
 * Which way is up, answered by the room itself: the floor's own normal.
 *
 * THE FRAME IS NOT OURS TO ASSUME. A real capture (Owen's bathroom, Aug 18) arrived Z-UP —
 * every wall's z-extent was exactly the 2.31 m ceiling height — while this module assumed y-up.
 * "Height" came out as a wall's horizontal component and "width" as a diagonal, so the room card
 * printed "Wall 2 · 12' 4" × 1' 6" · 74.3 sq ft": arithmetic that contradicts itself on a surface
 * whose whole job is being auditable. Areas never suffered (Newell is frame-free), which is
 * exactly what made the wrong dims visible.
 *
 * Whatever frame a capture arrives in, its floor is horizontal — so the floor's normal IS the
 * vertical. A geometry whose floor is degenerate falls back to y-up, the old assumption, which
 * is also the manual-room case where nothing reads dims at all.
 */
export function roomUp(g: NormalizedGeometry): Point3 {
  const v = g.floorPolygon.vertices;
  if (v.length < MIN_POLYGON_VERTICES) return Y_UP;

  // Newell normal — same construction polygonArea takes the magnitude of.
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < v.length; i++) {
    const a = v[i]!;
    const b = v[(i + 1) % v.length]!;
    nx += (a.y - b.y) * (a.z + b.z);
    ny += (a.z - b.z) * (a.x + b.x);
    nz += (a.x - b.x) * (a.y + b.y);
  }
  // Epsilon, not exact zero: a numerically-degenerate floor (a sliver polygon from an aborted
  // scan) has a TINY nonzero normal, and normalizing that noise yields a garbage up — often
  // horizontal — which transposes every wall's dims. The magnitude here is 2× the floor's area;
  // 0.01 m² of floor is no floor.
  const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (len < 0.02) return Y_UP;
  return { x: nx / len, y: ny / len, z: nz / len };
}

/**
 * Width, height and area of one wall polygon, measured against the room's up direction.
 *
 * Height is the extent ALONG up; width is the largest distance between any two vertices once
 * up is projected out — the horizontal run, whatever frame the capture arrived in. For the
 * rectangle a wall actually is, width × height equals the Newell area, which is the invariant
 * the room card's breakdown displays. `up` defaults to y for callers with no geometry in hand;
 * anything holding a NormalizedGeometry should pass roomUp(g).
 */
export function wallDimensions(
  wall: { readonly polygon: { readonly vertices: readonly Point3[] } },
  up: Point3 = Y_UP,
): WallDimensions {
  const v = wall.polygon.vertices;
  if (v.length < MIN_POLYGON_VERTICES) return ZERO;

  let minH = Infinity;
  let maxH = -Infinity;
  for (const p of v) {
    const h = p.x * up.x + p.y * up.y + p.z * up.z;
    if (h < minH) minH = h;
    if (h > maxH) maxH = h;
  }

  // Horizontal positions: each vertex with its up-component removed.
  const flat = v.map((p) => {
    const h = p.x * up.x + p.y * up.y + p.z * up.z;
    return { x: p.x - h * up.x, y: p.y - h * up.y, z: p.z - h * up.z };
  });
  let widthM = 0;
  for (let i = 0; i < flat.length; i++) {
    for (let j = i + 1; j < flat.length; j++) {
      const a = flat[i]!;
      const b = flat[j]!;
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const dz = a.z - b.z;
      const span = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (span > widthM) widthM = span;
    }
  }

  return { widthM, heightM: maxH - minH, areaM2: polygonArea(v) };
}

/**
 * Square feet a deduction removes, derived from the capture's own geometry.
 *
 * Returns null when the deduction cannot be answered — a band with no height. That is not zero:
 * zero would price as "nothing is tiled" when the truth is "nobody has said how high yet", and
 * the room card shows it as needing an answer instead of quietly pricing full walls.
 *
 * An index that does not resolve is skipped rather than throwing: geometry can be replaced by a
 * re-scan under a deduction that outlived it, and a stale index must not take down the room.
 */
export function deriveDeductionSqft(
  g: NormalizedGeometry,
  d: Deduction,
  wallOverrides: Readonly<Record<number, number>> = {},
): number | null {
  // Order-insensitive, duplicates count ONCE — the selectedWalls contract, kept.
  const indexes = [...new Set(d.wallIndexes)];

  if (d.kind === "whole_wall") {
    // The painter's number where one exists — a whole-wall deduction on an EDITED wall must
    // remove what the room now claims that wall is, or net = (gross with the edit) − (the
    // scanner's number) strands phantom square feet in the estimate.
    const sqft = indexes.reduce((sum, index) => {
      const w = g.walls[index];
      if (!w) return sum;
      const override = wallOverrides[index];
      if (override !== undefined) return sum + override;
      return sum + polygonArea(w.polygon.vertices) * SQ_METERS_TO_SQFT;
    }, 0);
    return round1(sqft);
  }

  if (d.heightM === null || !Number.isFinite(d.heightM) || d.heightM < 0) return null;

  // Clamped PER WALL, not once against the tallest: a band taller than a given wall covers that
  // wall entirely, and letting it over-run would subtract area the room does not have.
  const up = roomUp(g);
  const sqft = indexes.reduce((sum, index) => {
    const w = g.walls[index];
    if (!w) return sum;
    const { widthM, heightM, areaM2 } = wallDimensions(w, up);
    // width × band-height is a RECTANGLE'S band. On a gable wall the bounding box holds more
    // area than the wall does, so an uncapped band could subtract more than whole_wall would —
    // deducting area the room does not have. A band can never remove more than the wall —
    // and "the wall" is the painter's number when they edited it.
    const wallSqft = wallOverrides[index] ?? areaM2 * SQ_METERS_TO_SQFT;
    const bandSqft = widthM * Math.min(d.heightM as number, heightM) * SQ_METERS_TO_SQFT;
    return sum + Math.min(bandSqft, wallSqft);
  }, 0);
  return round1(sqft);
}

/**
 * Paintable wall area: gross less every deduction, floored at zero.
 *
 * Null gross stays null — while walls_sqft is needs_confirm there is no measured number to
 * subtract from, and treating it as 0 would present an unmeasured room as fully deducted.
 * A deduction whose own area could not be derived is skipped, for the same reason it is null.
 */
export function netWallsSqft(grossSqft: number | null, deductions: readonly (number | null)[]): number | null {
  if (grossSqft === null) return null;
  const total = deductions.reduce<number>((sum, d) => sum + (d ?? 0), 0);
  return round1(Math.max(0, grossSqft - total));
}
