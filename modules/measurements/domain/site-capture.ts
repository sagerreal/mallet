import type { JobId, OrgId, Result, ValidationError } from "@mallet/shared/types";
import { validation, ok, err } from "@mallet/shared/types";

export type SiteCaptureSource = "aerial_trace_v1" | "manual";
export type SiteSurface = "flat" | "pitched";

const VALID_SOURCES: readonly SiteCaptureSource[] = ["aerial_trace_v1", "manual"];
const VALID_SURFACES: readonly SiteSurface[] = ["flat", "pitched"];
const MAX_NAME_LENGTH = 80;
const MIN_PITCH_RISE = 1;
const MAX_PITCH_RISE = 24;
const MIN_POLYGON_VERTICES = 3;

export interface SitePolygonVertex {
  readonly lat: number;
  readonly lng: number;
}

// Roof edge classes for PITCHED surfaces. Defined here (not imported from
// lib/measure/edge-classes.ts) so the domain stays free of app-layer imports —
// the API mapper bridges the two, and its assignments are the compile-time
// parity check if the unions ever drift.
export type SiteEdgeClass = "eave" | "rake" | "ridge" | "hip" | "valley";
export type SiteInteriorLineClass = "ridge" | "hip" | "valley";

const VALID_EDGE_CLASSES: readonly SiteEdgeClass[] = ["eave", "rake", "ridge", "hip", "valley"];
const VALID_INTERIOR_CLASSES: readonly SiteInteriorLineClass[] = ["ridge", "hip", "valley"];

/** A classed roof line drawn inside the footprint (a hip roof's ridge). */
export interface SiteInteriorLine {
  readonly a: SitePolygonVertex;
  readonly b: SitePolygonVertex;
  readonly cls: SiteInteriorLineClass;
}

// The map view the surface was traced against — persisted so the tracer UI can re-open the
// capture centered exactly where it was drawn.
export interface SitePolygonView {
  readonly centerLat: number;
  readonly centerLng: number;
  readonly zoom: number;
}

// The polygon jsonb shape is VERSIONED ADDITIVELY: edgeClasses/interiorLines
// arrived after the first captures shipped, so both are optional — a legacy
// capture without them is UNCLASSIFIED (readers must treat absence as "no
// classes", never guess). When edgeClasses is present it is parallel to
// vertices: edge i runs vertex i → vertex i+1 (wrapping back to vertex 0).
export interface SitePolygon {
  readonly vertices: readonly SitePolygonVertex[];
  readonly view: SitePolygonView;
  readonly edgeClasses?: readonly SiteEdgeClass[];
  readonly interiorLines?: readonly SiteInteriorLine[];
}

export interface SiteCaptureProps {
  readonly id: string;
  readonly orgId: OrgId;
  readonly jobId: JobId;
  readonly name: string;
  readonly source: SiteCaptureSource;
  readonly surface: SiteSurface;
  readonly pitchRise: number | null; // rise-per-12 (4 = 4/12); null for flat
  readonly polygon: SitePolygon | null; // null for manual entries
  readonly footprintSqft: number | null; // flat/plan area as traced; null for manual
  readonly areaSqft: number; // the working number (pitch-corrected for pitched surfaces)
  readonly perimeterLnft: number | null; // traced edge length; null for manual
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly deletedAt: Date | null;
}

// Slope correction for a pitched surface measured from above: satellite imagery only shows the
// plan-view footprint, but material covers the sloped face. rise-per-12 pitch means the slope
// factor is 1 / cos(atan(rise/12)); rise 0 passes the footprint through unchanged. The domain
// owns this math — use-cases recompute area server-side from footprint + pitch rather than
// trusting a client-sent area. Rounded to 2dp to match the numeric(12,2) column.
export const pitchCorrectedArea = (footprintSqft: number, pitchRise: number): number => {
  const corrected = footprintSqft / Math.cos(Math.atan(pitchRise / 12));
  return Math.round(corrected * 100) / 100;
};

const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

// One outdoor surface (driveway, patio, walkway, roof facet) traced on satellite imagery or
// entered by hand. Immutable; the factory enforces invariants so an invalid SiteCapture can
// never exist.
export class SiteCapture {
  private constructor(private readonly p: SiteCaptureProps) {}

  static create(props: SiteCaptureProps): Result<SiteCapture, ValidationError> {
    const name = props.name.trim();
    if (name.length === 0) return err(validation("name is required", "name"));
    if (name.length > MAX_NAME_LENGTH) {
      return err(validation(`name must be ${MAX_NAME_LENGTH} characters or fewer`, "name"));
    }

    if (!VALID_SOURCES.includes(props.source)) {
      return err(validation(`invalid source: "${props.source}"`, "source"));
    }
    if (!VALID_SURFACES.includes(props.surface)) {
      return err(validation(`invalid surface: "${props.surface}"`, "surface"));
    }

    if (props.surface === "flat" && props.pitchRise !== null) {
      return err(validation("pitch must be absent for a flat surface", "pitchRise"));
    }
    if (props.surface === "pitched") {
      if (
        props.pitchRise === null ||
        !Number.isInteger(props.pitchRise) ||
        props.pitchRise < MIN_PITCH_RISE ||
        props.pitchRise > MAX_PITCH_RISE
      ) {
        return err(
          validation(
            `pitch must be a whole rise-per-12 between ${MIN_PITCH_RISE} and ${MAX_PITCH_RISE}`,
            "pitchRise",
          ),
        );
      }
    }

    if (!isFiniteNumber(props.areaSqft) || props.areaSqft <= 0) {
      return err(validation("area must be a finite number greater than 0", "areaSqft"));
    }

    if (props.polygon !== null) {
      const polygonError = validatePolygon(props.polygon);
      if (polygonError !== null) return err(polygonError);
      if (!isFiniteNumber(props.footprintSqft) || props.footprintSqft <= 0) {
        return err(validation("footprint must be a finite number greater than 0 for a traced surface", "footprintSqft"));
      }
    }

    if (props.footprintSqft !== null && (!isFiniteNumber(props.footprintSqft) || props.footprintSqft <= 0)) {
      return err(validation("footprint must be a finite number greater than 0", "footprintSqft"));
    }
    if (props.perimeterLnft !== null && (!isFiniteNumber(props.perimeterLnft) || props.perimeterLnft <= 0)) {
      return err(validation("perimeter must be a finite number greater than 0", "perimeterLnft"));
    }

    if (props.source === "aerial_trace_v1" && props.polygon === null) {
      return err(validation("a traced polygon is required for an aerial_trace_v1 capture", "polygon"));
    }
    if (props.source === "manual" && props.polygon !== null) {
      return err(validation("polygon must be absent for a manual capture", "polygon"));
    }
    if (props.source === "manual" && props.footprintSqft !== null) {
      return err(validation("footprint must be absent for a manual capture", "footprintSqft"));
    }

    return ok(new SiteCapture({ ...props, name }));
  }

  get props(): SiteCaptureProps {
    return this.p;
  }
}

const validatePolygon = (polygon: SitePolygon): ValidationError | null => {
  if (!Array.isArray(polygon.vertices) || polygon.vertices.length < MIN_POLYGON_VERTICES) {
    return validation(`polygon needs at least ${MIN_POLYGON_VERTICES} vertices`, "polygon");
  }
  for (const v of polygon.vertices) {
    if (!isFiniteNumber(v?.lat) || !isFiniteNumber(v?.lng)) {
      return validation("polygon vertices must have finite lat/lng", "polygon");
    }
  }
  const view = polygon.view;
  if (!isFiniteNumber(view?.centerLat) || !isFiniteNumber(view?.centerLng) || !isFiniteNumber(view?.zoom)) {
    return validation("polygon view must have finite centerLat/centerLng/zoom", "polygon");
  }
  if (polygon.edgeClasses !== undefined) {
    if (!Array.isArray(polygon.edgeClasses) || polygon.edgeClasses.length !== polygon.vertices.length) {
      return validation("edgeClasses must have one class per polygon edge", "polygon");
    }
    for (const cls of polygon.edgeClasses) {
      if (!VALID_EDGE_CLASSES.includes(cls)) {
        return validation(`invalid edge class: "${String(cls)}"`, "polygon");
      }
    }
  }
  if (polygon.interiorLines !== undefined) {
    if (!Array.isArray(polygon.interiorLines)) {
      return validation("interiorLines must be an array", "polygon");
    }
    for (const line of polygon.interiorLines) {
      if (
        !isFiniteNumber(line?.a?.lat) ||
        !isFiniteNumber(line?.a?.lng) ||
        !isFiniteNumber(line?.b?.lat) ||
        !isFiniteNumber(line?.b?.lng)
      ) {
        return validation("interior lines must have finite endpoints", "polygon");
      }
      if (!VALID_INTERIOR_CLASSES.includes(line.cls)) {
        return validation(`invalid interior line class: "${String(line.cls)}"`, "polygon");
      }
    }
  }
  return null;
};

// Parses an untrusted jsonb value (DB read path) into a SitePolygon. The write path is typed by
// zod at the router boundary; this exists so the mapper never blindly casts stored json.
export const parseSitePolygon = (value: unknown): Result<SitePolygon, ValidationError> => {
  if (typeof value !== "object" || value === null) {
    return err(validation("polygon must be an object", "polygon"));
  }
  const candidate = value as {
    vertices?: unknown;
    view?: unknown;
    edgeClasses?: unknown;
    interiorLines?: unknown;
  };
  if (!Array.isArray(candidate.vertices)) {
    return err(validation("polygon vertices must be an array", "polygon"));
  }
  const vertices: SitePolygonVertex[] = [];
  for (const raw of candidate.vertices) {
    const v = raw as { lat?: unknown; lng?: unknown } | null;
    if (!isFiniteNumber(v?.lat) || !isFiniteNumber(v?.lng)) {
      return err(validation("polygon vertices must have finite lat/lng", "polygon"));
    }
    vertices.push({ lat: v.lat, lng: v.lng });
  }
  const view = (candidate.view ?? null) as { centerLat?: unknown; centerLng?: unknown; zoom?: unknown } | null;
  if (!isFiniteNumber(view?.centerLat) || !isFiniteNumber(view?.centerLng) || !isFiniteNumber(view?.zoom)) {
    return err(validation("polygon view must have finite centerLat/centerLng/zoom", "polygon"));
  }

  // v2 additive fields — ABSENT on legacy rows (that's valid: unclassified).
  // Present-but-malformed is corruption and fails loudly like the rest of the
  // shape; structural rules (length parity, known classes) run in
  // validatePolygon below.
  let edgeClasses: SiteEdgeClass[] | undefined;
  if (candidate.edgeClasses !== undefined) {
    if (!Array.isArray(candidate.edgeClasses)) {
      return err(validation("polygon edgeClasses must be an array", "polygon"));
    }
    edgeClasses = [];
    for (const raw of candidate.edgeClasses) {
      if (typeof raw !== "string" || !VALID_EDGE_CLASSES.includes(raw as SiteEdgeClass)) {
        return err(validation(`invalid edge class: "${String(raw)}"`, "polygon"));
      }
      edgeClasses.push(raw as SiteEdgeClass);
    }
  }
  let interiorLines: SiteInteriorLine[] | undefined;
  if (candidate.interiorLines !== undefined) {
    if (!Array.isArray(candidate.interiorLines)) {
      return err(validation("polygon interiorLines must be an array", "polygon"));
    }
    interiorLines = [];
    for (const raw of candidate.interiorLines) {
      const line = raw as { a?: { lat?: unknown; lng?: unknown }; b?: { lat?: unknown; lng?: unknown }; cls?: unknown } | null;
      if (
        !isFiniteNumber(line?.a?.lat) ||
        !isFiniteNumber(line?.a?.lng) ||
        !isFiniteNumber(line?.b?.lat) ||
        !isFiniteNumber(line?.b?.lng)
      ) {
        return err(validation("interior lines must have finite endpoints", "polygon"));
      }
      if (typeof line.cls !== "string" || !VALID_INTERIOR_CLASSES.includes(line.cls as SiteInteriorLineClass)) {
        return err(validation(`invalid interior line class: "${String(line?.cls)}"`, "polygon"));
      }
      interiorLines.push({
        a: { lat: line.a.lat, lng: line.a.lng },
        b: { lat: line.b.lat, lng: line.b.lng },
        cls: line.cls as SiteInteriorLineClass,
      });
    }
  }

  const polygon: SitePolygon = {
    vertices,
    view: { centerLat: view.centerLat, centerLng: view.centerLng, zoom: view.zoom },
    ...(edgeClasses !== undefined ? { edgeClasses } : {}),
    ...(interiorLines !== undefined ? { interiorLines } : {}),
  };
  const structural = validatePolygon(polygon);
  if (structural !== null) return err(structural);
  return ok(polygon);
};
