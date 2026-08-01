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

// The map view the surface was traced against — persisted so the tracer UI can re-open the
// capture centered exactly where it was drawn.
export interface SitePolygonView {
  readonly centerLat: number;
  readonly centerLng: number;
  readonly zoom: number;
}

export interface SitePolygon {
  readonly vertices: readonly SitePolygonVertex[];
  readonly view: SitePolygonView;
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
  return null;
};

// Parses an untrusted jsonb value (DB read path) into a SitePolygon. The write path is typed by
// zod at the router boundary; this exists so the mapper never blindly casts stored json.
export const parseSitePolygon = (value: unknown): Result<SitePolygon, ValidationError> => {
  if (typeof value !== "object" || value === null) {
    return err(validation("polygon must be an object", "polygon"));
  }
  const candidate = value as { vertices?: unknown; view?: unknown };
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
  const polygon: SitePolygon = {
    vertices,
    view: { centerLat: view.centerLat, centerLng: view.centerLng, zoom: view.zoom },
  };
  const structural = validatePolygon(polygon);
  if (structural !== null) return err(structural);
  return ok(polygon);
};
