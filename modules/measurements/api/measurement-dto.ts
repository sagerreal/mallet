import { z } from "zod";
import type { RoomCaptureWithQuantities } from "../domain/measurement-repository";
import type { SiteCapture } from "../domain/site-capture";

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

// Unlike room geometry, a site polygon IS returned in the DTO — the tracer UI re-draws it on
// the map, and a hand-traced outline is small (tens of vertices, not a RoomPlan mesh).
export const sitePolygonDTO = z.object({
  vertices: z.array(z.object({ lat: z.number(), lng: z.number() })).min(3),
  view: z.object({ centerLat: z.number(), centerLng: z.number(), zoom: z.number() }),
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
  createdAt: z.string(),
});

export type QuantityDTO = z.infer<typeof quantityDTO>;
export type RoomCaptureDTO = z.infer<typeof roomCaptureDTO>;
export type SitePolygonDTO = z.infer<typeof sitePolygonDTO>;
export type SiteCaptureDTO = z.infer<typeof siteCaptureDTO>;

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
          },
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
