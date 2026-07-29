import { asOrgId, asJobId } from "@mallet/shared/types";
import { roomCaptures, paintingRoomQuantities } from "@mallet/shared/db/schema";
import { RoomCapture, type RoomCaptureSource } from "../domain/room-capture";
import { parseNormalizedGeometry } from "../domain/normalized-geometry";
import type { PaintingQuantityKind } from "../domain/derive-painting";
import type { StoredQuantity, QuantityStatus, RoomCaptureWithQuantities } from "../domain/measurement-repository";

export type RoomCaptureRow = typeof roomCaptures.$inferSelect;
export type PaintingRoomQuantityRow = typeof paintingRoomQuantities.$inferSelect;

// Reconstruct a domain RoomCapture from a DB row. Corrupt data throws rather than silently
// coercing — the same contract as company-mapper's toDomain.
export const toDomainCapture = (row: RoomCaptureRow): RoomCapture => {
  let geometry = null;
  if (row.geometry !== null) {
    const parsed = parseNormalizedGeometry(row.geometry);
    if (!parsed.ok) {
      throw new Error(`corrupt room_capture ${row.id} geometry: ${parsed.error.message}`);
    }
    geometry = parsed.value;
  }

  const result = RoomCapture.create({
    id: row.id,
    orgId: asOrgId(row.orgId),
    jobId: asJobId(row.jobId),
    roomName: row.roomName,
    source: row.source as RoomCaptureSource,
    rawPayload: row.rawPayload,
    geometry,
    capturedAt: row.capturedAt,
    supersededById: row.supersededById,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  });
  if (!result.ok) {
    throw new Error(`corrupt room_capture ${row.id}: ${result.error.message}`);
  }
  return result.value;
};

export const toStoredQuantity = (row: PaintingRoomQuantityRow): StoredQuantity => ({
  kind: row.kind as PaintingQuantityKind,
  value: row.value,
  derivedValue: row.derivedValue,
  status: row.status as QuantityStatus,
});

export const toCaptureWithQuantities = (
  row: RoomCaptureRow,
  quantityRows: readonly PaintingRoomQuantityRow[],
): RoomCaptureWithQuantities => ({
  capture: toDomainCapture(row),
  quantities: quantityRows.map(toStoredQuantity),
});
