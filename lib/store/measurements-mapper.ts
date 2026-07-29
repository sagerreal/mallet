/**
 * lib/store/measurements-mapper.ts
 * Single DTO→store conversion site for room captures ("measurements").
 * Used by useJobRooms (hydration) AND measurements-slice mutation reconcile
 * paths — one shape, one mapper. No money in this module.
 */

import type { RoomCard, RoomQuantity } from "./types";

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
