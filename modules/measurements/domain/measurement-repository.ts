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

// Thrown by `supersede` instead of silently no-op'ing: an unconditional UPDATE-then-INSERT
// would create an unlinked "current" capture if the old id doesn't resolve (wrong org,
// already deleted, already superseded, or belongs to a different job). Task-4 use-cases catch
// this and map it to a typed Result error (notFound/conflict from @mallet/shared/types) at
// the app boundary — the repo itself only needs to fail loudly, not choose the AppError kind.
export class SupersedeTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SupersedeTargetError";
  }
}

// The org is NEVER a parameter — it is implicit in the org-scoped transaction the repository
// is constructed with, so a caller physically cannot address another tenant's captures.
export interface MeasurementRepository {
  // One tx: inserts the capture row and its quantity rows atomically.
  createCapture(capture: RoomCapture, quantities: readonly PaintingQuantity[]): Promise<void>;

  // Current (not superseded, not deleted) captures for a job, newest capturedAt (then id) first.
  listByJob(jobId: string): Promise<RoomCaptureWithQuantities[]>;

  getCapture(id: string): Promise<RoomCaptureWithQuantities | null>;

  // Re-scan chain: sets old.supersededById = next.id and inserts next + its quantities. One
  // tx — the old-row UPDATE runs first; if it affects 0 rows (missing/wrong-org/deleted/
  // already-superseded/wrong-job old id) this throws SupersedeTargetError BEFORE the insert,
  // so an unlinked "current" capture can never be created. Success is implied by not throwing.
  supersede(
    oldId: string,
    next: RoomCapture,
    quantities: readonly PaintingQuantity[],
  ): Promise<void>;

  // Patches value + status only — derivedValue is immutable once persisted. Returns the number
  // of rows affected (0 = no matching kind/capture in this org, or the parent capture is
  // soft-deleted) — same no-silent-fail contract as CompanyRepository.archive.
  setQuantity(
    captureId: string,
    kind: PaintingQuantityKind,
    patch: { value: number | null; status: QuantityStatus },
  ): Promise<number>;

  // Returns the number of rows affected (0 = not found / wrong org / already deleted).
  renameRoom(captureId: string, roomName: string): Promise<number>;

  // Soft-delete. Returns the number of rows affected (0 = not found / wrong org / already
  // deleted) — same contract as CompanyRepository.archive.
  archive(captureId: string): Promise<number>;
}
