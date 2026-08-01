/**
 * features/measurements/aerial/map-measure.ts
 * The one place the tracer touches google.maps.geometry — live figures for an
 * in-progress or saved trace. Unit conversion + rounding stay in
 * lib/measure/aerial-geometry.ts where they are unit-tested; this file is a
 * thin bridge to the loaded Maps API and returns null until it exists.
 */

import type { TraceVertex } from "@/lib/measure/trace-state";
import { sqMetersToSqft, metersToFeet, round2 } from "@/lib/measure/aerial-geometry";

export interface TraceFigures {
  /** Plan-view area of the outline as if closed, 2dp. 0 until 3 vertices exist. */
  readonly footprintSqft: number;
  /** Length of the drawn edges; includes the closing edge once closed. 2dp. */
  readonly perimeterLnft: number;
}

/**
 * Measures the traced path with the spherical geometry library. Returns null
 * when the Maps API isn't loaded yet or there is nothing to measure.
 */
export function measureTrace(
  vertices: readonly TraceVertex[],
  closed: boolean,
): TraceFigures | null {
  if (typeof google === "undefined" || typeof google.maps?.geometry === "undefined") return null;
  if (vertices.length < 2) return null;

  const path = vertices.map((v) => ({ lat: v.lat, lng: v.lng }));
  const first = path[0];
  const ring = closed && first !== undefined ? [...path, first] : path;

  const areaSqMeters = path.length >= 3 ? google.maps.geometry.spherical.computeArea(path) : 0;
  const lengthMeters = google.maps.geometry.spherical.computeLength(ring);

  return {
    footprintSqft: round2(sqMetersToSqft(areaSqMeters)),
    perimeterLnft: round2(metersToFeet(lengthMeters)),
  };
}
