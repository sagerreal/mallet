import type { RoomCapture } from "./room-capture";
import type { PaintingQuantity, PaintingQuantityKind } from "./derive-painting";

// Persistence-level status union — WIDER than the domain derivation union
// (`PaintingQuantity["status"]` is only 'derived' | 'needs_confirm', the two states a pure
// derivation can produce). Once a stored quantity can be user-edited it also carries
// 'override' (user changed the value) and 'confirmed' (user accepted the derived value
// as-is). Keep this union here, at the port boundary — do NOT widen the domain type.
export type QuantityStatus = "derived" | "override" | "confirmed" | "needs_confirm";

// A persisted painting quantity row: the working value/status plus the immutable
// scan-derived value it started from (null for manual rooms, which have no derivation).
export interface StoredQuantity {
  readonly kind: PaintingQuantityKind;
  readonly value: number | null;
  readonly derivedValue: number | null;
  readonly status: QuantityStatus;
}

export interface RoomCaptureWithQuantities {
  readonly capture: RoomCapture;
  readonly quantities: readonly StoredQuantity[];
}

// The org is NEVER a parameter — it is implicit in the org-scoped transaction the repository
// is constructed with, so a caller physically cannot address another tenant's captures.
export interface MeasurementRepository {
  // One tx: inserts the capture row and its quantity rows atomically.
  createCapture(capture: RoomCapture, quantities: readonly PaintingQuantity[]): Promise<void>;

  // Current (not superseded, not deleted) captures for a job, newest capturedAt first.
  listByJob(jobId: string): Promise<RoomCaptureWithQuantities[]>;

  getCapture(id: string): Promise<RoomCaptureWithQuantities | null>;

  // Re-scan chain: sets old.supersededById = next.id and inserts next + its quantities.
  // One tx — the old capture is never left pointing nowhere if the insert fails.
  supersede(
    oldId: string,
    next: RoomCapture,
    quantities: readonly PaintingQuantity[],
  ): Promise<void>;

  // Patches value + status only — derivedValue is immutable once persisted.
  setQuantity(
    captureId: string,
    kind: PaintingQuantityKind,
    patch: { value: number | null; status: QuantityStatus },
  ): Promise<void>;

  renameRoom(captureId: string, roomName: string): Promise<void>;

  // Soft-delete.
  archive(captureId: string): Promise<void>;
}
