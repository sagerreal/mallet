import { z } from "zod";
import { edgeTotalsFt, isClassified, roofComplexity } from "@/lib/measure/edge-classes";
import type { RoomCaptureWithQuantities } from "../domain/measurement-repository";
import type { SiteCapture, SitePolygon } from "../domain/site-capture";

// Heavy fields (geometry, rawPayload) are deliberately excluded from the list DTO — a
// `getGeometry` procedure can be added later for the floor-plan outline UI when it needs them.
export const quantityDTO = z.object({
  kind: z.enum(["walls_sqft", "ceiling_sqft", "baseboard_lnft", "crown_lnft", "doors_count", "windows_count"]),
  value: z.number().nullable(),
  derivedValue: z.number().nullable(),
  status: z.enum(["derived", "override", "confirmed", "needs_confirm"]),
});

export const roomCaptureDTO = z.object({
  id: z.string().uuid(),
  jobId: z.string().uuid(),
  roomName: z.string(),
  source: z.enum(["roomplan_v1", "manual"]),
  capturedAt: z.string(),
  quantities: z.array(quantityDTO),
});

const latLngDTO = z.object({ lat: z.number(), lng: z.number() });
const edgeClassDTO = z.enum(["eave", "rake", "ridge", "hip", "valley"]);
const interiorLineClassDTO = z.enum(["ridge", "hip", "valley"]);

// Unlike room geometry, a site polygon IS returned in the DTO — the tracer UI re-draws it on
// the map, and a hand-traced outline is small (tens of vertices, not a RoomPlan mesh).
// edgeClasses/interiorLines are the v2 additive classification (roof edges) — optional both
// ways: legacy captures never carried them, and flat surfaces don't classify.
export const sitePolygonDTO = z.object({
  vertices: z.array(latLngDTO).min(3),
  view: z.object({ centerLat: z.number(), centerLng: z.number(), zoom: z.number() }),
  edgeClasses: z.array(edgeClassDTO).optional(),
  interiorLines: z.array(z.object({ a: latLngDTO, b: latLngDTO, cls: interiorLineClassDTO })).optional(),
});

// Server-derived per-class linears (plan-view feet, 2dp) — computed from the stored polygon on
// every read, never trusted from the client. Null when the capture is unclassified.
export const siteEdgeTotalsDTO = z.object({
  eaveFt: z.number(),
  rakeFt: z.number(),
  ridgeFt: z.number(),
  hipFt: z.number(),
  valleyFt: z.number(),
});

// Waste-relevant complexity hint for the roofing recipes: hip/valley counts across perimeter
// edges and interior lines; any at all marks the roof cut-up. Null when unclassified.
export const siteComplexityDTO = z.object({
  hips: z.number().int(),
  valleys: z.number().int(),
  cutUp: z.boolean(),
});

export const siteCaptureDTO = z.object({
  id: z.string().uuid(),
  jobId: z.string().uuid(),
  name: z.string(),
  source: z.enum(["aerial_trace_v1", "manual"]),
  surface: z.enum(["flat", "pitched"]),
  pitchRise: z.number().int().nullable(),
  areaSqft: z.number(),
  footprintSqft: z.number().nullable(),
  perimeterLnft: z.number().nullable(),
  polygon: sitePolygonDTO.nullable(),
  edges: siteEdgeTotalsDTO.nullable(),
  complexity: siteComplexityDTO.nullable(),
  createdAt: z.string(),
});

export type QuantityDTO = z.infer<typeof quantityDTO>;
export type RoomCaptureDTO = z.infer<typeof roomCaptureDTO>;
export type SitePolygonDTO = z.infer<typeof sitePolygonDTO>;
export type SiteEdgeTotalsDTO = z.infer<typeof siteEdgeTotalsDTO>;
export type SiteComplexityDTO = z.infer<typeof siteComplexityDTO>;
export type SiteCaptureDTO = z.infer<typeof siteCaptureDTO>;

// The domain's SiteEdgeClass / lib's EdgeClass seam: these assignments are the compile-time
// parity check — if either union drifts, edgeTotalsFt/roofComplexity below stop typechecking.
const toEdgesDTO = (polygon: SitePolygon): SiteEdgeTotalsDTO | null => {
  if (!isClassified(polygon.edgeClasses, polygon.interiorLines)) return null;
  return edgeTotalsFt(polygon.vertices, polygon.edgeClasses, polygon.interiorLines);
};

const toComplexityDTO = (polygon: SitePolygon): SiteComplexityDTO | null => {
  if (!isClassified(polygon.edgeClasses, polygon.interiorLines)) return null;
  return roofComplexity(polygon.edgeClasses, polygon.interiorLines);
};

export const toSiteCaptureDTO = (capture: SiteCapture): SiteCaptureDTO => {
  const p = capture.props;
  return {
    id: p.id,
    jobId: p.jobId,
    name: p.name,
    source: p.source,
    surface: p.surface,
    pitchRise: p.pitchRise,
    areaSqft: p.areaSqft,
    footprintSqft: p.footprintSqft,
    perimeterLnft: p.perimeterLnft,
    polygon:
      p.polygon === null
        ? null
        : {
            vertices: p.polygon.vertices.map((v) => ({ lat: v.lat, lng: v.lng })),
            view: { ...p.polygon.view },
            ...(p.polygon.edgeClasses !== undefined
              ? { edgeClasses: [...p.polygon.edgeClasses] }
              : {}),
            ...(p.polygon.interiorLines !== undefined
              ? {
                  interiorLines: p.polygon.interiorLines.map((l) => ({
                    a: { ...l.a },
                    b: { ...l.b },
                    cls: l.cls,
                  })),
                }
              : {}),
          },
    edges: p.polygon === null ? null : toEdgesDTO(p.polygon),
    complexity: p.polygon === null ? null : toComplexityDTO(p.polygon),
    createdAt: p.createdAt.toISOString(),
  };
};

export const toRoomCaptureDTO = (room: RoomCaptureWithQuantities): RoomCaptureDTO => {
  const p = room.capture.props;
  return {
    id: p.id,
    jobId: p.jobId,
    roomName: p.roomName,
    source: p.source,
    capturedAt: p.capturedAt.toISOString(),
    quantities: room.quantities.map((q) => ({
      kind: q.kind,
      value: q.value,
      derivedValue: q.derivedValue,
      status: q.status,
    })),
  };
};
