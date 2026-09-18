import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { roomCaptures, paintingRoomQuantities, siteCaptures, roomDeductions } from "@mallet/shared/db/schema";
import type { TenantTx } from "@mallet/shared/db/tx";
import type { OrgId } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import type { RoomCapture } from "../domain/room-capture";
import type { SiteCapture } from "../domain/site-capture";
import { toWireGeometry } from "../domain/normalized-geometry";
import type { PaintingQuantity, PaintingQuantityKind } from "../domain/derive-painting";
import type { TrimRunKind } from "../domain/trim-area";
import {
  SupersedeTargetError,
  DuplicateCaptureError,
  JobNotFoundError,
  CaptureNotFoundError,
  type MeasurementRepository,
  type StoredDeduction,
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
import {
  toDomainCapture,
  toDomainSiteCapture,
  toStoredQuantity,
  toCaptureWithQuantities,
  toStoredDeduction,
  type RoomDeductionRow,
  CorruptCaptureError,
  type RoomCaptureRow,
  type SiteCaptureRow,
} from "./measurement-mapper";

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

  async setTrimHeight(captureId: string, kind: TrimRunKind, heightIn: number | null): Promise<number> {
    // Same soft-delete guard as setQuantity: a quantity row has no deletedAt of its own, so
    // without this subquery the UPDATE would silently "succeed" against an archived room.
    const liveCaptureIds = this.tx
      .select({ id: roomCaptures.id })
      .from(roomCaptures)
      .where(and(eq(roomCaptures.orgId, this.orgId), isNull(roomCaptures.deletedAt)));

    const rows = await this.tx
      .update(paintingRoomQuantities)
      .set({ heightIn, updatedAt: new Date() })
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
  // ATOMIC PER-KEY PATCH, not read-modify-write: the tech edits wall 0 on the phone while the
  // office edits wall 1 — two whole-map writes under READ COMMITTED would each read {} and the
  // second would erase the first, both callers told success. `||` / `-` apply to the row's
  // CURRENT value at update time (the blocked writer re-reads after the lock), so both keys
  // land whatever the order. Returns the final map so the caller computes the total from what
  // is actually stored, never from its own stale read. Null = missing/deleted/SUPERSEDED — a
  // re-scanned room's old card must refuse the write loudly, not swallow it (the listByJob
  // filter would hide the edit forever).
  async patchWallOverride(
    captureId: string,
    wallIndex: number,
    sqft: number | null,
  ): Promise<Readonly<Record<number, number>> | null> {
    const key = String(wallIndex);
    const expr =
      sqft === null
        ? sql`${roomCaptures.wallOverrides} - ${key}`
        : sql`${roomCaptures.wallOverrides} || jsonb_build_object(${key}::text, ${sqft}::numeric)`;
    const rows = await this.tx
      .update(roomCaptures)
      .set({ wallOverrides: expr, updatedAt: new Date() })
      .where(
        and(
          eq(roomCaptures.orgId, this.orgId),
          eq(roomCaptures.id, captureId),
          isNull(roomCaptures.deletedAt),
          isNull(roomCaptures.supersededById),
        ),
      )
      .returning({ wallOverrides: roomCaptures.wallOverrides });
    if (rows.length === 0) return null;
    return rows[0]!.wallOverrides as Readonly<Record<number, number>>;
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

  // ── site captures (aerial takeoff) ─────────────────────────────────────────

  // EXPLICIT column list on insert — a values() built from a spread once silently dropped a
  // newly added column; every column is named here so a schema/domain drift breaks the build
  // instead of writing nulls.
  async createSiteCapture(capture: SiteCapture): Promise<void> {
    const p = capture.props;
    try {
      await this.tx.insert(siteCaptures).values({
        id: p.id,
        orgId: this.orgId,
        jobId: p.jobId,
        name: p.name,
        source: p.source,
        surface: p.surface,
        pitchRise: p.pitchRise,
        polygon: p.polygon,
        footprintSqft: p.footprintSqft,
        areaSqft: p.areaSqft,
        perimeterLnft: p.perimeterLnft,
      });
    } catch (e) {
      // 23503 = foreign_key_violation; scoped to the jobs FK by name so an unrelated FK
      // violation on this statement (e.g. the orgs FK) isn't misclassified as JobNotFound.
      const { code, constraint } = pgErrorInfo(e);
      if (code === "23503" && (constraint === null || constraint === "site_captures_job_fk")) {
        throw new JobNotFoundError(p.jobId);
      }
      throw e;
    }
  }

  async getSiteCapture(id: string): Promise<SiteCapture | null> {
    const rows = await this.tx
      .select()
      .from(siteCaptures)
      .where(and(eq(siteCaptures.id, id), eq(siteCaptures.orgId, this.orgId), isNull(siteCaptures.deletedAt)))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    // Direct open of ONE capture — a corrupt row fails loudly (same deliberate asymmetry as
    // getCapture vs listByJob above).
    return toDomainSiteCapture(row);
  }

  async listSiteCaptures(jobId: string): Promise<SiteCapture[]> {
    const rows = await this.tx
      .select()
      .from(siteCaptures)
      .where(
        and(
          eq(siteCaptures.orgId, this.orgId),
          eq(siteCaptures.jobId, jobId),
          isNull(siteCaptures.deletedAt),
        ),
      )
      .orderBy(desc(siteCaptures.createdAt), desc(siteCaptures.id));

    // Same skip-and-log contract as listByJob: one unreadable capture (corrupt polygon/props)
    // must not blank the whole job's site list.
    const healthy: SiteCapture[] = [];
    for (const row of rows as SiteCaptureRow[]) {
      try {
        healthy.push(toDomainSiteCapture(row));
      } catch (e) {
        if (!(e instanceof CorruptCaptureError)) throw e;
        logger.warn({ captureId: row.id }, "measurements.site_capture.unreadable");
      }
    }
    return healthy;
  }

  // Patches name/surface/pitch/area only — id, source, polygon, footprint and perimeter are
  // fixed at capture time (the port documents the same contract). EXPLICIT column list, same
  // rationale as createSiteCapture.
  async updateSiteCapture(capture: SiteCapture): Promise<number> {
    const p = capture.props;
    const rows = await this.tx
      .update(siteCaptures)
      .set({
        name: p.name,
        surface: p.surface,
        pitchRise: p.pitchRise,
        areaSqft: p.areaSqft,
        updatedAt: new Date(),
      })
      .where(and(eq(siteCaptures.id, p.id), eq(siteCaptures.orgId, this.orgId), isNull(siteCaptures.deletedAt)))
      .returning();
    return rows.length;
  }

  async archiveSiteCapture(captureId: string): Promise<number> {
    const now = new Date();
    const rows = await this.tx
      .update(siteCaptures)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(eq(siteCaptures.id, captureId), eq(siteCaptures.orgId, this.orgId), isNull(siteCaptures.deletedAt)))
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
          wallOverrides: capture.wallOverrides,
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
          // derivedValue is carried separately from value: for measured kinds they start
          // equal; for convention kinds (trim) derivedValue holds the suggestion while
          // value stays null until a human confirms.
          derivedValue: q.derivedValue,
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
      .where(and(eq(paintingRoomQuantities.orgId, this.orgId), inArray(paintingRoomQuantities.captureId, captureIds)))
      // Deterministic order (alphabetical by kind) — without this Postgres is free to return
      // quantity rows in any order, so the same capture's `quantities` array could differ
      // between two reads (e.g. a duplicate-ingest retry's getCapture vs. the original
      // createCapture response). API stability for every consumer, not just tests.
      .orderBy(paintingRoomQuantities.kind);

    const byCapture = new Map<string, typeof quantityRows>();
    for (const q of quantityRows) {
      const arr = byCapture.get(q.captureId) ?? [];
      arr.push(q);
      byCapture.set(q.captureId, arr);
    }

    const dedByCapture = await this.deductionsFor(captureIds);

    return rows.map((row) =>
      toCaptureWithQuantities(row, byCapture.get(row.id) ?? [], dedByCapture.get(row.id) ?? []),
    );
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
      } catch (e) {
        // Narrowed to the mapper's own "this row is unreadable" signal — anything else (a real
        // bug elsewhere in toDomainCapture) rethrows instead of being silently swallowed here.
        if (!(e instanceof CorruptCaptureError)) throw e;
        logger.warn({ captureId: row.id }, "measurements.capture.unreadable");
      }
    }
    if (healthy.length === 0) return [];

    const captureIds = healthy.map((h) => h.row.id);
    const quantityRows = await this.tx
      .select()
      .from(paintingRoomQuantities)
      .where(and(eq(paintingRoomQuantities.orgId, this.orgId), inArray(paintingRoomQuantities.captureId, captureIds)))
      // Same deterministic ordering as attachQuantities above — keep both read paths consistent.
      .orderBy(paintingRoomQuantities.kind);

    const byCapture = new Map<string, typeof quantityRows>();
    for (const q of quantityRows) {
      const arr = byCapture.get(q.captureId) ?? [];
      arr.push(q);
      byCapture.set(q.captureId, arr);
    }

    const dedByCapture = await this.deductionsFor(captureIds);

    return healthy.map(({ row, capture }) => ({
      capture,
      quantities: (byCapture.get(row.id) ?? []).map(toStoredQuantity),
      deductions: (dedByCapture.get(row.id) ?? []).map(toStoredDeduction),
    }));
  }

  /**
   * Live deductions for a page of captures, keyed by capture id — ONE IN-clause read, never one
   * per room. A job's room list is the screen an estimator reloads most, and a per-room query
   * here would be exactly the N+1 the quantity loader above already avoids.
   *
   * Ordered by createdAt then id so the same room's deductions cannot come back in a different
   * order between two reads — the estimate renders them as a list, and a shuffling list reads as
   * a changed estimate.
   */
  private async deductionsFor(captureIds: readonly string[]): Promise<Map<string, RoomDeductionRow[]>> {
    const byCapture = new Map<string, RoomDeductionRow[]>();
    if (captureIds.length === 0) return byCapture;

    const rows = await this.tx
      .select()
      .from(roomDeductions)
      .where(
        and(
          eq(roomDeductions.orgId, this.orgId),
          inArray(roomDeductions.captureId, [...captureIds]),
          isNull(roomDeductions.deletedAt),
        ),
      )
      .orderBy(roomDeductions.createdAt, roomDeductions.id);

    for (const r of rows) {
      const arr = byCapture.get(r.captureId) ?? [];
      arr.push(r);
      byCapture.set(r.captureId, arr);
    }
    return byCapture;
  }

  async addDeduction(captureId: string, deduction: StoredDeduction): Promise<void> {
    try {
      await this.tx.insert(roomDeductions).values({
        id: deduction.id,
        orgId: this.orgId,
        captureId,
        reason: deduction.reason,
        kind: deduction.kind,
        // Stored as inputs, never as an area — see StoredDeduction. Spread to a plain array so a
        // readonly domain value cannot be handed to the driver as a frozen reference.
        wallIndexes: [...deduction.wallIndexes],
        heightM: deduction.heightM,
      });
    } catch (e: unknown) {
      // 23503 = foreign_key_violation; scoped to the capture FK by name so an unrelated FK
      // violation on this statement isn't misclassified. Same contract as createCapture's
      // JobNotFound: a typed error, never a raw driver failure surfacing to the app layer.
      const { code, constraint } = pgErrorInfo(e);
      if (code === "23503" && (constraint === null || constraint === "room_deductions_capture_fk")) {
        throw new CaptureNotFoundError(captureId);
      }
      throw e;
    }
  }

  async archiveDeduction(deductionId: string): Promise<number> {
    const rows = await this.tx
      .update(roomDeductions)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(roomDeductions.id, deductionId),
          eq(roomDeductions.orgId, this.orgId),
          isNull(roomDeductions.deletedAt),
        ),
      )
      .returning();
    return rows.length;
  }
}
