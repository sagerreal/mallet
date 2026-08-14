import type { RoomCapture } from "./room-capture";
import type { SiteCapture } from "./site-capture";
import type { PaintingQuantity, PaintingQuantityKind } from "./derive-painting";
import type { DeductionKind } from "./wall-deductions";

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

/**
 * A persisted deduction: wall area this room does NOT get painted, chosen by tap.
 *
 * INPUTS ONLY — wallIndexes + heightM are what the painter selected. The square footage is never
 * stored: it is derived from the capture's own geometry on every read (wall-deductions.ts), so a
 * re-scan re-derives instead of leaving a stale number priced into an estimate.
 */
export interface StoredDeduction {
  readonly id: string;
  readonly reason: string;
  readonly kind: DeductionKind;
  readonly wallIndexes: readonly number[];
  readonly heightM: number | null;
}

export interface RoomCaptureWithQuantities {
  readonly capture: RoomCapture;
  readonly quantities: readonly StoredQuantity[];
  /** Loaded with the capture — the room card needs them to show a net, so never a second read. */
  readonly deductions: readonly StoredDeduction[];
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

// Thrown by `createCapture` (and the new-capture leg of `supersede`) when the capture id
// collides with an existing row's primary key (Postgres 23505 on room_captures_pkey). Retrying
// a scan upload with the same client-authored id is expected (flaky network, app relaunch) —
// the app-layer use-case catches this and returns the ALREADY-PERSISTED capture instead of a
// throw, so a retry is truly idempotent rather than a duplicate error.
export class DuplicateCaptureError extends Error {
  constructor(public readonly id: string) {
    super(`room capture ${id} already exists`);
    this.name = "DuplicateCaptureError";
  }
}

// Thrown by `createCapture` when the FK to jobs (room_captures_job_fk) is violated (Postgres
// 23503) — the given jobId doesn't resolve for this org. The app-layer use-case catches this
// and maps it to a typed not-found Result error instead of letting a raw FK violation surface.
export class JobNotFoundError extends Error {
  constructor(public readonly jobId: string) {
    super(`job ${jobId} not found`);
    this.name = "JobNotFoundError";
  }
}

// Thrown by `addDeduction` when the FK to room_captures (room_deductions_capture_fk) is violated
// (Postgres 23503) — the capture doesn't resolve for this org. The app-layer use-case maps it to a
// typed not-found Result rather than letting a raw FK violation surface.
export class CaptureNotFoundError extends Error {
  constructor(public readonly captureId: string) {
    super(`room capture ${captureId} not found`);
    this.name = "CaptureNotFoundError";
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

  // ── deductions (wall area that is not painted) ─────────────────────────────

  // Throws CaptureNotFoundError when the (org_id, capture_id) FK doesn't resolve for this org.
  addDeduction(captureId: string, deduction: StoredDeduction): Promise<void>;

  // Soft-delete. Returns rows affected (0 = not found / wrong org / already deleted) — the same
  // no-silent-fail contract as archive().
  archiveDeduction(deductionId: string): Promise<number>;

  // Soft-delete. Returns the number of rows affected (0 = not found / wrong org / already
  // deleted) — same contract as CompanyRepository.archive.
  archive(captureId: string): Promise<number>;

  // ── site captures (aerial takeoff — outdoor surfaces) ──────────────────────

  // Throws JobNotFoundError when the (org_id, job_id) FK doesn't resolve for this org.
  createSiteCapture(capture: SiteCapture): Promise<void>;

  // One capture by id (not deleted) — the update use-case reads the current row so it can
  // recompute the pitch-corrected area from the STORED footprint, never a client-sent area.
  getSiteCapture(id: string): Promise<SiteCapture | null>;

  // Not-deleted captures for a job, newest createdAt (then id) first.
  listSiteCaptures(jobId: string): Promise<SiteCapture[]>;

  // Patches name/surface/pitch/area only — id, source, polygon, footprint and perimeter are
  // fixed at capture time. Returns the number of rows affected (0 = not found / wrong org /
  // already deleted) — same no-silent-fail contract as archive.
  updateSiteCapture(capture: SiteCapture): Promise<number>;

  // Soft-delete. Returns the number of rows affected (0 = not found / wrong org / already
  // deleted).
  archiveSiteCapture(captureId: string): Promise<number>;
}
