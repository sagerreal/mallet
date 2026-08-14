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

/**
 * Width, height and area of one wall polygon.
 *
 * Height is the vertical extent. Width is measured IN THE WALL'S OWN PLANE — the largest
 * horizontal (XZ) distance between any two vertices — because a room arrives in its own frame and
 * almost no wall is axis-aligned. For the rectangle a wall actually is, that largest span is the
 * width. Area comes from Newell's method, which is plane-true even for a tilted wall.
 */
export function wallDimensions(wall: { readonly polygon: { readonly vertices: readonly Point3[] } }): WallDimensions {
  const v = wall.polygon.vertices;
  if (v.length < MIN_POLYGON_VERTICES) return ZERO;

  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of v) {
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }

  let widthM = 0;
  for (let i = 0; i < v.length; i++) {
    for (let j = i + 1; j < v.length; j++) {
      const a = v[i]!;
      const b = v[j]!;
      const dx = a.x - b.x;
      const dz = a.z - b.z;
      const span = Math.sqrt(dx * dx + dz * dz);
      if (span > widthM) widthM = span;
    }
  }

  return { widthM, heightM: maxY - minY, areaM2: polygonArea(v) };
}

/** The distinct, in-range walls a deduction actually names. */
const selectedWalls = (g: NormalizedGeometry, wallIndexes: readonly number[]) =>
  [...new Set(wallIndexes)]
    .map((i) => g.walls[i])
    .filter((w): w is NonNullable<typeof w> => w !== undefined);

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
export function deriveDeductionSqft(g: NormalizedGeometry, d: Deduction): number | null {
  const walls = selectedWalls(g, d.wallIndexes);

  if (d.kind === "whole_wall") {
    const m2 = walls.reduce((sum, w) => sum + polygonArea(w.polygon.vertices), 0);
    return round1(m2 * SQ_METERS_TO_SQFT);
  }

  if (d.heightM === null || !Number.isFinite(d.heightM) || d.heightM < 0) return null;

  // Clamped PER WALL, not once against the tallest: a band taller than a given wall covers that
  // wall entirely, and letting it over-run would subtract area the room does not have.
  const m2 = walls.reduce((sum, w) => {
    const { widthM, heightM } = wallDimensions(w);
    return sum + widthM * Math.min(d.heightM as number, heightM);
  }, 0);
  return round1(m2 * SQ_METERS_TO_SQFT);
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
