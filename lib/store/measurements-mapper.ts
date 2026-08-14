/**
 * lib/store/measurements-mapper.ts
 * Single DTO→store conversion site for room captures ("measurements").
 * Used by useJobRooms (hydration) AND measurements-slice mutation reconcile
 * paths — one shape, one mapper. No money in this module.
 */

import type {
  RoomCard,
  RoomDeduction,
  RoomQuantity,
  RoomWall,
  SiteCard,
  SiteComplexity,
  SiteEdgeTotals,
  SitePolygonShape,
} from "./types";

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
  // Optional on the WIRE, required in the store. A rolling deploy puts new client code in front
  // of an older server for a few minutes; that response has no deductions key, and reading
  // `.map` off it would take down the whole room list. Absent degrades to "none recorded yet",
  // which is visibly wrong for a moment and self-corrects, rather than a crash that is not.
  deductions?: readonly RoomDeduction[];
  walls?: readonly RoomWall[];
  netWallsSqft?: number | null;
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
  edges: SiteEdgeTotals | null;
  complexity: SiteComplexity | null;
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
            ...(dto.polygon.edgeClasses !== undefined
              ? { edgeClasses: [...dto.polygon.edgeClasses] }
              : {}),
            ...(dto.polygon.interiorLines !== undefined
              ? {
                  interiorLines: dto.polygon.interiorLines.map((l) => ({
                    a: { ...l.a },
                    b: { ...l.b },
                    cls: l.cls,
                  })),
                }
              : {}),
          },
    edges: dto.edges === null ? null : { ...dto.edges },
    complexity: dto.complexity === null ? null : { ...dto.complexity },
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
    // Copied field-by-field, not spread: the store's shape is its own contract, and a widened
    // DTO must not silently deposit unknown keys in the store.
    deductions: (dto.deductions ?? []).map((d) => ({
      id: d.id,
      reason: d.reason,
      kind: d.kind,
      wallIndexes: [...d.wallIndexes],
      heightM: d.heightM,
      sqft: d.sqft,
    })),
    walls: (dto.walls ?? []).map((w) => ({
      index: w.index,
      widthFt: w.widthFt,
      heightFt: w.heightFt,
      sqft: w.sqft,
    })),
    netWallsSqft: dto.netWallsSqft ?? null,
  };
}
