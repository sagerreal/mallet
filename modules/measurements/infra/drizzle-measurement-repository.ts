import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { roomCaptures, paintingRoomQuantities } from "@mallet/shared/db/schema";
import type { TenantTx } from "@mallet/shared/db/tx";
import type { OrgId } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import type { RoomCapture } from "../domain/room-capture";
import { toWireGeometry } from "../domain/normalized-geometry";
import type { PaintingQuantity, PaintingQuantityKind } from "../domain/derive-painting";
import {
  SupersedeTargetError,
  DuplicateCaptureError,
  JobNotFoundError,
  type MeasurementRepository,
  type RoomCaptureWithQuantities,
  type QuantityStatus,
} from "../domain/measurement-repository";

// The `postgres` driver (postgres.js) throws a `PostgresError` whose enumerable own properties
// mirror the Postgres error-response fields: `code` (SQLSTATE, e.g. "23505"/"23503") and
// `constraint_name` (the violated constraint, when the error is constraint-scoped). Neither is
// typed by the driver's public types, so we narrow through `unknown` rather than trust a cast.
// Drizzle never lets that PostgresError surface directly, though: `postgres-js/session.ts`
// catches it and rethrows a `DrizzleQueryError` (message "Failed query: ...") with the original
// error attached as `.cause` — so `code`/`constraint_name` have to be read off `e.cause`, not `e`
// itself (confirmed against node_modules/drizzle-orm/errors.js — no other precedent for reading
// this driver's error shape exists in shared/ or modules/, so this walk is new).
// Constraining on `constraint_name` (not just the SQLSTATE) matters: 23505 is the generic
// unique-violation code, so an unrelated unique constraint on the same statement must not be
// misclassified as a duplicate capture id.
function pgErrorInfo(e: unknown): { code: string | null; constraint: string | null } {
  const cause = e instanceof Error && e.cause !== undefined ? e.cause : e;
  if (!(cause instanceof Error)) return { code: null, constraint: null };
  const withPgFields = cause as { code?: unknown; constraint_name?: unknown };
  return {
    code: typeof withPgFields.code === "string" ? withPgFields.code : null,
    constraint: typeof withPgFields.constraint_name === "string" ? withPgFields.constraint_name : null,
  };
}
import { toDomainCapture, toStoredQuantity, toCaptureWithQuantities, type RoomCaptureRow } from "./measurement-mapper";

// Real persistence. Constructed with a tenant-scoped transaction (withTenant already set
// app.current_org_id), so RLS appends `org_id = current_org_id()` to every statement. orgId is
// supplied only to stamp inserted rows and guard explicit-tenant writes — same pattern as
// drizzle-company-repository.ts.
export class DrizzleMeasurementRepository implements MeasurementRepository {
  constructor(
    private readonly tx: TenantTx,
    private readonly orgId: OrgId,
  ) {}

  async createCapture(capture: RoomCapture, quantities: readonly PaintingQuantity[]): Promise<void> {
    await this.insertCaptureWithQuantities(capture, quantities);
  }

  async listByJob(jobId: string): Promise<RoomCaptureWithQuantities[]> {
    const rows = await this.tx
      .select()
      .from(roomCaptures)
      .where(
        and(
          eq(roomCaptures.orgId, this.orgId),
          eq(roomCaptures.jobId, jobId),
          isNull(roomCaptures.supersededById),
          isNull(roomCaptures.deletedAt),
        ),
      )
      // capturedAt is client-supplied (device clock), so ties are possible — desc(id) as a
      // deterministic secondary key, same pattern as drizzle-company-repository's list().
      .orderBy(desc(roomCaptures.capturedAt), desc(roomCaptures.id));

    if (rows.length === 0) return [];
    return this.attachQuantitiesSkippingCorrupt(rows);
  }

  // getCapture is a direct open of ONE capture — unlike listByJob, a corrupt row here must
  // fail loudly (toDomainCapture, via toCaptureWithQuantities/attachQuantities, throws). This
  // is a deliberate asymmetry with listByJob's skip-and-log: silently returning null would hide
  // real corruption from whoever explicitly asked for this exact capture.
  async getCapture(id: string): Promise<RoomCaptureWithQuantities | null> {
    const rows = await this.tx
      .select()
      .from(roomCaptures)
      .where(and(eq(roomCaptures.id, id), eq(roomCaptures.orgId, this.orgId), isNull(roomCaptures.deletedAt)))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    const [withQuantities] = await this.attachQuantities([row]);
    return withQuantities ?? null;
  }

  async supersede(oldId: string, next: RoomCapture, quantities: readonly PaintingQuantity[]): Promise<void> {
    // The old-row UPDATE runs FIRST and is checked before the insert — an unconditional
    // UPDATE-then-INSERT would create an unlinked "current" capture if oldId doesn't resolve
    // (wrong org, already deleted, already superseded) or belongs to a different job than
    // `next`. Zero affected rows means the guard failed, and we throw before ever inserting.
    const updated = await this.tx
      .update(roomCaptures)
      .set({ supersededById: next.props.id, updatedAt: new Date() })
      .where(
        and(
          eq(roomCaptures.id, oldId),
          eq(roomCaptures.orgId, this.orgId),
          eq(roomCaptures.jobId, next.props.jobId),
          isNull(roomCaptures.deletedAt),
          isNull(roomCaptures.supersededById),
        ),
      )
      .returning();

    if (updated.length === 0) {
      throw new SupersedeTargetError(
        `room capture ${oldId} was not found, already deleted, already superseded, or does not belong to job ${next.props.jobId}`,
      );
    }

    await this.insertCaptureWithQuantities(next, quantities);
  }

  async setQuantity(
    captureId: string,
    kind: PaintingQuantityKind,
    patch: { value: number | null; status: QuantityStatus },
  ): Promise<number> {
    // derivedValue is deliberately absent from the SET clause — it is immutable once persisted.
    // The captureId subquery excludes quantities whose parent capture is soft-deleted (or
    // belongs to another org) — a quantity row itself has no deletedAt, so without this the
    // UPDATE would silently "succeed" against an archived room.
    const liveCaptureIds = this.tx
      .select({ id: roomCaptures.id })
      .from(roomCaptures)
      .where(and(eq(roomCaptures.orgId, this.orgId), isNull(roomCaptures.deletedAt)));

    const rows = await this.tx
      .update(paintingRoomQuantities)
      .set({ value: patch.value, status: patch.status, updatedAt: new Date() })
      .where(
        and(
          eq(paintingRoomQuantities.captureId, captureId),
          eq(paintingRoomQuantities.kind, kind),
          eq(paintingRoomQuantities.orgId, this.orgId),
          inArray(paintingRoomQuantities.captureId, liveCaptureIds),
        ),
      )
      .returning();
    return rows.length;
  }

  async renameRoom(captureId: string, roomName: string): Promise<number> {
    const rows = await this.tx
      .update(roomCaptures)
      .set({ roomName, updatedAt: new Date() })
      .where(and(eq(roomCaptures.id, captureId), eq(roomCaptures.orgId, this.orgId), isNull(roomCaptures.deletedAt)))
      .returning();
    return rows.length;
  }

  async archive(captureId: string): Promise<number> {
    const now = new Date();
    const rows = await this.tx
      .update(roomCaptures)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(eq(roomCaptures.id, captureId), eq(roomCaptures.orgId, this.orgId), isNull(roomCaptures.deletedAt)))
      .returning();
    return rows.length;
  }

  // Inserts a capture row and its quantity rows on `this.tx` — the caller (createCapture /
  // supersede) is already running inside a single transaction (withTenant), so this method
  // never opens its own transaction; it just keeps the two-table write co-located.
  private async insertCaptureWithQuantities(
    capture: RoomCapture,
    quantities: readonly PaintingQuantity[],
  ): Promise<void> {
    const p = capture.props;
    let rows: RoomCaptureRow[];
    try {
      rows = await this.tx
        .insert(roomCaptures)
        .values({
          id: p.id,
          orgId: this.orgId,
          jobId: p.jobId,
          roomName: p.roomName,
          source: p.source,
          rawPayload: p.rawPayload,
          geometry: p.geometry ? toWireGeometry(p.geometry) : null,
          capturedAt: p.capturedAt,
          supersededById: p.supersededById,
        })
        // A Postgres transaction is poisoned after ANY statement error — every later statement
        // on the same tx (including the getCapture the app layer needs for true idempotency)
        // fails with "current transaction is aborted" until rollback. So the duplicate-id case
        // is handled WITHOUT ever raising a unique_violation: ON CONFLICT (id) DO NOTHING turns
        // a colliding insert into a silent no-op (0 rows returned) instead of an error, keeping
        // the tx alive so the caller can still query inside it. `id` is room_captures' PK, so
        // this target also covers the composite room_captures_org_id_uq (org_id, id) — that
        // constraint can never fire without `id` alone already colliding on the PK first.
        .onConflictDoNothing({ target: roomCaptures.id })
        .returning();
    } catch (e) {
      // Only a genuine hard error reaches here now — the id-collision case above no longer
      // throws. 23503 = foreign_key_violation; scoped to the jobs FK by name so an unrelated FK
      // violation on this statement (e.g. the orgs FK) isn't misclassified as JobNotFound.
      const { code, constraint } = pgErrorInfo(e);
      if (code === "23503" && (constraint === null || constraint === "room_captures_job_fk")) {
        throw new JobNotFoundError(p.jobId);
      }
      throw e;
    }
    const row = rows[0];
    // onConflictDoNothing skipped the insert — id already exists. Throw BEFORE the quantities
    // insert below: quantities are keyed (org_id, capture_id, kind), so inserting them against
    // an id that already has quantities would raise a second, unhandled unique violation.
    if (!row) throw new DuplicateCaptureError(p.id);

    if (quantities.length > 0) {
      await this.tx.insert(paintingRoomQuantities).values(
        quantities.map((q) => ({
          orgId: this.orgId,
          captureId: row.id,
          kind: q.kind,
          value: q.value,
          // The initial persisted derivedValue is the freshly derived number — null when the
          // derivation itself came back needs_confirm (nothing to preserve).
          derivedValue: q.value,
          status: q.status,
        })),
      );
    }
  }

  // Batch-loads quantities for a page of captures in ONE query (no N+1) — same pattern as
  // drizzle-checklist-repository's loadItems.
  private async attachQuantities(rows: readonly RoomCaptureRow[]): Promise<RoomCaptureWithQuantities[]> {
    const captureIds = rows.map((r) => r.id);
    const quantityRows = await this.tx
      .select()
      .from(paintingRoomQuantities)
      .where(and(eq(paintingRoomQuantities.orgId, this.orgId), inArray(paintingRoomQuantities.captureId, captureIds)));

    const byCapture = new Map<string, typeof quantityRows>();
    for (const q of quantityRows) {
      const arr = byCapture.get(q.captureId) ?? [];
      arr.push(q);
      byCapture.set(q.captureId, arr);
    }

    return rows.map((row) => toCaptureWithQuantities(row, byCapture.get(row.id) ?? []));
  }

  // listByJob's variant of attachQuantities: one unreadable capture (corrupt geometry/props —
  // toDomainCapture throws) must not fail the whole job's room list. Each row is mapped
  // individually so a bad row can be skipped and logged instead of aborting the page; getCapture
  // deliberately keeps the throwing path (see its comment above) — this method exists only for
  // the multi-row list.
  private async attachQuantitiesSkippingCorrupt(rows: readonly RoomCaptureRow[]): Promise<RoomCaptureWithQuantities[]> {
    const healthy: { row: RoomCaptureRow; capture: RoomCapture }[] = [];
    for (const row of rows) {
      try {
        healthy.push({ row, capture: toDomainCapture(row) });
      } catch {
        logger.warn({ captureId: row.id }, "measurements.capture.unreadable");
      }
    }
    if (healthy.length === 0) return [];

    const captureIds = healthy.map((h) => h.row.id);
    const quantityRows = await this.tx
      .select()
      .from(paintingRoomQuantities)
      .where(and(eq(paintingRoomQuantities.orgId, this.orgId), inArray(paintingRoomQuantities.captureId, captureIds)));

    const byCapture = new Map<string, typeof quantityRows>();
    for (const q of quantityRows) {
      const arr = byCapture.get(q.captureId) ?? [];
      arr.push(q);
      byCapture.set(q.captureId, arr);
    }

    return healthy.map(({ row, capture }) => ({
      capture,
      quantities: (byCapture.get(row.id) ?? []).map(toStoredQuantity),
    }));
  }
}
