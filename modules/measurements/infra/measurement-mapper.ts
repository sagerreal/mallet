import { asOrgId, asJobId } from "@mallet/shared/types";
import { roomCaptures, paintingRoomQuantities, siteCaptures, roomDeductions } from "@mallet/shared/db/schema";
import { RoomCapture, type RoomCaptureSource } from "../domain/room-capture";
import { SiteCapture, parseSitePolygon, type SiteCaptureSource, type SiteSurface } from "../domain/site-capture";
import { parseNormalizedGeometry } from "../domain/normalized-geometry";
import type { PaintingQuantityKind } from "../domain/derive-painting";
import type {
  StoredQuantity,
  QuantityStatus,
  RoomCaptureWithQuantities,
  StoredDeduction,
} from "../domain/measurement-repository";
import type { DeductionKind } from "../domain/wall-deductions";

export type RoomCaptureRow = typeof roomCaptures.$inferSelect;
export type RoomDeductionRow = typeof roomDeductions.$inferSelect;
export type PaintingRoomQuantityRow = typeof paintingRoomQuantities.$inferSelect;
export type SiteCaptureRow = typeof siteCaptures.$inferSelect;

// Thrown by `toDomainCapture` when a row's geometry jsonb fails schema parsing or its props fail
// domain validation — i.e. the row itself is unreadable, not a bug in the caller. A dedicated
// class (rather than a bare Error) so `drizzle-measurement-repository.ts`'s listByJob can narrow
// its catch to exactly this failure mode and skip the row, while any OTHER exception (a real
// bug) still propagates instead of being silently swallowed.
export class CorruptCaptureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CorruptCaptureError";
  }
}

// Reconstruct a domain RoomCapture from a DB row. Corrupt data throws rather than silently
// coercing — the same contract as company-mapper's toDomain.
//
// Deliberate asymmetry: this throw is what makes `getCapture` (a direct open of one capture)
// fail loudly on corrupt geometry/props. `listByJob` (drizzle-measurement-repository.ts) does
// NOT let this throw escape the page — it catches CorruptCaptureError specifically per-row,
// skips the unreadable capture, and logs `measurements.capture.unreadable` so one bad row can't
// blank a whole job's room list.
export const toDomainCapture = (row: RoomCaptureRow): RoomCapture => {
  let geometry = null;
  if (row.geometry !== null) {
    const parsed = parseNormalizedGeometry(row.geometry);
    if (!parsed.ok) {
      throw new CorruptCaptureError(`corrupt room_capture ${row.id} geometry: ${parsed.error.message}`);
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
    throw new CorruptCaptureError(`corrupt room_capture ${row.id}: ${result.error.message}`);
  }
  return result.value;
};

// Reconstruct a domain SiteCapture from a DB row. Same contract as toDomainCapture: an
// unreadable row (corrupt polygon jsonb / props failing domain validation) throws
// CorruptCaptureError so the repository's list path can skip-and-log it per-row while a direct
// getSiteCapture open fails loudly.
export const toDomainSiteCapture = (row: SiteCaptureRow): SiteCapture => {
  let polygon = null;
  if (row.polygon !== null) {
    const parsed = parseSitePolygon(row.polygon);
    if (!parsed.ok) {
      throw new CorruptCaptureError(`corrupt site_capture ${row.id} polygon: ${parsed.error.message}`);
    }
    polygon = parsed.value;
  }

  const result = SiteCapture.create({
    id: row.id,
    orgId: asOrgId(row.orgId),
    jobId: asJobId(row.jobId),
    name: row.name,
    source: row.source as SiteCaptureSource,
    surface: row.surface as SiteSurface,
    pitchRise: row.pitchRise,
    polygon,
    footprintSqft: row.footprintSqft,
    areaSqft: row.areaSqft,
    perimeterLnft: row.perimeterLnft,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  });
  if (!result.ok) {
    throw new CorruptCaptureError(`corrupt site_capture ${row.id}: ${result.error.message}`);
  }
  return result.value;
};

export const toStoredQuantity = (row: PaintingRoomQuantityRow): StoredQuantity => ({
  kind: row.kind as PaintingQuantityKind,
  value: row.value,
  derivedValue: row.derivedValue,
  status: row.status as QuantityStatus,
});

/**
 * A deduction row → domain. `wall_indexes` is jsonb, so it arrives as `unknown`: anything that is
 * not a finite integer is dropped rather than trusted. A malformed index would otherwise reach
 * geometry lookup as NaN and silently derive a deduction of zero — a room priced for full walls
 * with a deduction sitting visibly on it, which is the worst of both.
 */
export const toStoredDeduction = (row: RoomDeductionRow): StoredDeduction => ({
  id: row.id,
  reason: row.reason,
  kind: row.kind as DeductionKind,
  wallIndexes: Array.isArray(row.wallIndexes)
    ? row.wallIndexes.filter((n): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0)
    : [],
  heightM: row.heightM,
});

export const toCaptureWithQuantities = (
  row: RoomCaptureRow,
  quantityRows: readonly PaintingRoomQuantityRow[],
  deductionRows: readonly RoomDeductionRow[] = [],
): RoomCaptureWithQuantities => ({
  capture: toDomainCapture(row),
  quantities: quantityRows.map(toStoredQuantity),
  deductions: deductionRows.map(toStoredDeduction),
});
