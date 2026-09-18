/**
 * lib/measure/edge-classes.ts
 * Roof edge classification for the aerial tracer: the five classes a pitched
 * surface's edges can carry (eave / rake / ridge / hip / valley), the tap-cycle
 * order, and the per-class length math. PURE and dependency-free — this is the
 * single implementation shared by the client (held traces, the tracer's live
 * readout) and the server (DTO derivation in measurement-dto.ts), so the two
 * sides cannot drift. Parity is asserted in held-trace.edges.test.ts against
 * the real server mapper.
 *
 * Lengths are PLAN-VIEW feet (what satellite imagery shows), matching the
 * existing perimeterLnft convention. Slope correction for rakes/hips/valleys
 * is a pricing concern — the roofing recipes that consume these totals apply
 * pitch factors there, not here.
 */

/** One perimeter edge's class. Edge i runs vertex i → vertex i+1 (wrapping). */
export type EdgeClass = "eave" | "rake" | "ridge" | "hip" | "valley";

/** Classes an INTERIOR line can carry — the roof lines that cross a footprint. */
export type InteriorLineClass = "ridge" | "hip" | "valley";

/** Tap-cycle order: EAVE → RAKE → RIDGE → HIP → VALLEY → EAVE. */
export const EDGE_CLASSES: readonly EdgeClass[] = ["eave", "rake", "ridge", "hip", "valley"];

/** Interior lines cycle RIDGE → HIP → VALLEY → RIDGE. */
export const INTERIOR_LINE_CLASSES: readonly InteriorLineClass[] = ["ridge", "hip", "valley"];

export interface EdgeLatLng {
  readonly lat: number;
  readonly lng: number;
}

/** A classed line drawn inside the footprint (a hip roof's ridge, a valley). */
export interface InteriorLineShape {
  readonly a: EdgeLatLng;
  readonly b: EdgeLatLng;
  readonly cls: InteriorLineClass;
}

/** Plan-view feet per class, 2dp — the derived quantities recipes price from. */
export interface EdgeTotalsFt {
  readonly eaveFt: number;
  readonly rakeFt: number;
  readonly ridgeFt: number;
  readonly hipFt: number;
  readonly valleyFt: number;
}

/** Waste-relevant complexity: hips/valleys mean cut-up planes, more waste. */
export interface RoofComplexity {
  readonly hips: number;
  readonly valleys: number;
  readonly cutUp: boolean;
}

export function cycleEdgeClass(cls: EdgeClass): EdgeClass {
  const i = EDGE_CLASSES.indexOf(cls);
  return EDGE_CLASSES[(i + 1) % EDGE_CLASSES.length] as EdgeClass;
}

export function cycleInteriorLineClass(cls: InteriorLineClass): InteriorLineClass {
  const i = INTERIOR_LINE_CLASSES.indexOf(cls);
  return INTERIOR_LINE_CLASSES[(i + 1) % INTERIOR_LINE_CLASSES.length] as InteriorLineClass;
}

/** Every edge starts as an EAVE — the most common class, one tap to change. */
export function defaultEdgeClasses(vertexCount: number): EdgeClass[] {
  return Array.from({ length: vertexCount }, () => "eave" as EdgeClass);
}

// Google's spherical geometry library (the client's measuring stick for area
// and perimeter) models the earth as a sphere of this radius; using the same
// value keeps our per-class lengths consistent with the perimeter the tracer
// already shows.
const EARTH_RADIUS_METERS = 6378137;
const FEET_PER_METER = 1 / 0.3048;

const toRad = (deg: number): number => (deg * Math.PI) / 180;

/** Great-circle distance (haversine) — matches google.maps spherical lengths. */
export function sphericalDistanceMeters(a: EdgeLatLng, b: EdgeLatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Plan-view feet per class: perimeter edge i (vertex i → i+1, wrapping) adds
 * its length to edgeClasses[i]; every interior line adds to its own class.
 * A missing/short edgeClasses entry contributes nothing (legacy captures are
 * unclassified, never guessed). Totals are rounded to 2dp at the end.
 */
export function edgeTotalsFt(
  vertices: readonly EdgeLatLng[],
  edgeClasses: readonly EdgeClass[] | undefined,
  interiorLines: readonly InteriorLineShape[] | undefined,
): EdgeTotalsFt {
  const meters: Record<EdgeClass, number> = { eave: 0, rake: 0, ridge: 0, hip: 0, valley: 0 };

  if (edgeClasses !== undefined && vertices.length >= 2) {
    for (let i = 0; i < vertices.length; i += 1) {
      const cls = edgeClasses[i];
      if (cls === undefined) continue;
      const a = vertices[i] as EdgeLatLng;
      const b = vertices[(i + 1) % vertices.length] as EdgeLatLng;
      meters[cls] += sphericalDistanceMeters(a, b);
    }
  }
  for (const line of interiorLines ?? []) {
    meters[line.cls] += sphericalDistanceMeters(line.a, line.b);
  }

  return {
    eaveFt: round2(meters.eave * FEET_PER_METER),
    rakeFt: round2(meters.rake * FEET_PER_METER),
    ridgeFt: round2(meters.ridge * FEET_PER_METER),
    hipFt: round2(meters.hip * FEET_PER_METER),
    valleyFt: round2(meters.valley * FEET_PER_METER),
  };
}

/**
 * Hip/valley counts across perimeter edges AND interior lines. Any at all
 * flags the roof cut-up — planes meet at angles, waste runs higher than a
 * simple gable. The recipes PR consumes this; the tracer shows nothing extra.
 */
export function roofComplexity(
  edgeClasses: readonly EdgeClass[] | undefined,
  interiorLines: readonly InteriorLineShape[] | undefined,
): RoofComplexity {
  let hips = 0;
  let valleys = 0;
  for (const cls of edgeClasses ?? []) {
    if (cls === "hip") hips += 1;
    if (cls === "valley") valleys += 1;
  }
  for (const line of interiorLines ?? []) {
    if (line.cls === "hip") hips += 1;
    if (line.cls === "valley") valleys += 1;
  }
  return { hips, valleys, cutUp: hips + valleys > 0 };
}

/** True when the polygon carries any classification — legacy captures don't. */
export function isClassified(
  edgeClasses: readonly EdgeClass[] | undefined,
  interiorLines: readonly InteriorLineShape[] | undefined,
): boolean {
  return edgeClasses !== undefined || (interiorLines?.length ?? 0) > 0;
}

// ---- display ----------------------------------------------------------------

/** Legend/readout label per class (the readout totals a class, so "Eaves"). */
export const EDGE_CLASS_LABELS: Record<EdgeClass, string> = {
  eave: "Eaves",
  rake: "Rakes",
  ridge: "Ridge",
  hip: "Hips",
  valley: "Valleys",
};

/** Whole feet for the readout — "160 ft". */
export function formatEdgeFt(ft: number): string {
  return `${Math.round(ft).toLocaleString("en-US")} ft`;
}

const TOTAL_BY_CLASS: Record<EdgeClass, (t: EdgeTotalsFt) => number> = {
  eave: (t) => t.eaveFt,
  rake: (t) => t.rakeFt,
  ridge: (t) => t.ridgeFt,
  hip: (t) => t.hipFt,
  valley: (t) => t.valleyFt,
};

export function edgeTotalFor(totals: EdgeTotalsFt, cls: EdgeClass): number {
  return TOTAL_BY_CLASS[cls](totals);
}

/**
 * The classed-linears readout: non-zero classes in cycle order —
 * "Eaves 160 ft · Rakes 100 ft · Ridge 40 ft". Empty string when nothing is
 * classified (callers fall back to the plain perimeter).
 */
export function edgeReadout(totals: EdgeTotalsFt): string {
  return EDGE_CLASSES.filter((cls) => edgeTotalFor(totals, cls) > 0)
    .map((cls) => `${EDGE_CLASS_LABELS[cls]} ${formatEdgeFt(edgeTotalFor(totals, cls))}`)
    .join(" · ");
}

// ---- map overlay colors -----------------------------------------------------

// Overlays draw on satellite PHOTOGRAPHY, not themed UI, so these are FIXED hex
// values (the use-tracer-map OVERLAY_COLOR precedent — theme tokens go
// near-black in light mode and vanish on dark rooftops). Drawn from the app
// palette: white is the existing trace overlay (--pri-fg), the rest are the
// dark-theme accent values (amber/red/blue/purple), the variants tuned for
// dark backgrounds — which satellite imagery is.
export const EDGE_COLORS: Record<EdgeClass, string> = {
  eave: "#FFFFFF",
  rake: "#E0A53B",
  ridge: "#DE6F62",
  hip: "#8FA0C8",
  valley: "#9B8FCB",
};
