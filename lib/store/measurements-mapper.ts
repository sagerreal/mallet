/**
 * lib/store/measurements-mapper.ts
 * Single DTO→store conversion site for room captures ("measurements").
 * Used by useJobRooms (hydration) AND measurements-slice mutation reconcile
 * paths — one shape, one mapper. No money in this module.
 */

import type { RoomCard, RoomQuantity, SiteCard, SitePolygonShape } from "./types";

// The subset of RoomCaptureDTO (modules/measurements/api/measurement-dto.ts) this
// mapper needs — kept structural so callers don't have to import the module's
// server-side barrel into client bundle code.
interface RoomCaptureDtoShape {
  id: string;
  jobId: string;
  roomName: string;
  source: "roomplan_v1" | "manual";
  capturedAt: string;
  quantities: readonly RoomQuantity[];
}

// The subset of SiteCaptureDTO this mapper needs — structural for the same
// bundle-hygiene reason as RoomCaptureDtoShape above.
interface SiteCaptureDtoShape {
  id: string;
  jobId: string;
  name: string;
  source: "aerial_trace_v1" | "manual";
  surface: "flat" | "pitched";
  pitchRise: number | null;
  areaSqft: number;
  footprintSqft: number | null;
  perimeterLnft: number | null;
  polygon: SitePolygonShape | null;
  createdAt: string;
}

export function siteCaptureDtoToStore(dto: SiteCaptureDtoShape): SiteCard {
  return {
    id: dto.id,
    jobId: dto.jobId,
    name: dto.name,
    source: dto.source,
    surface: dto.surface,
    pitchRise: dto.pitchRise,
    areaSqft: dto.areaSqft,
    footprintSqft: dto.footprintSqft,
    perimeterLnft: dto.perimeterLnft,
    polygon:
      dto.polygon === null
        ? null
        : {
            vertices: dto.polygon.vertices.map((v) => ({ lat: v.lat, lng: v.lng })),
            view: { ...dto.polygon.view },
          },
    createdAt: dto.createdAt,
  };
}

export function roomCaptureDtoToStore(dto: RoomCaptureDtoShape): RoomCard {
  return {
    id: dto.id,
    jobId: dto.jobId,
    roomName: dto.roomName,
    source: dto.source,
    capturedAt: dto.capturedAt,
    quantities: dto.quantities.map((q) => ({
      kind: q.kind,
      value: q.value,
      derivedValue: q.derivedValue,
      status: q.status,
    })),
  };
}
