import { z } from "zod";
import type { RoomCaptureWithQuantities } from "../domain/measurement-repository";

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

export type QuantityDTO = z.infer<typeof quantityDTO>;
export type RoomCaptureDTO = z.infer<typeof roomCaptureDTO>;

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
