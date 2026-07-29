import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { roomCaptures, paintingRoomQuantities } from "@mallet/shared/db/schema";
import type { TenantTx } from "@mallet/shared/db/tx";
import type { OrgId } from "@mallet/shared/types";
import type { RoomCapture } from "../domain/room-capture";
import { toWireGeometry } from "../domain/normalized-geometry";
import type { PaintingQuantity, PaintingQuantityKind } from "../domain/derive-painting";
import type {
  MeasurementRepository,
  RoomCaptureWithQuantities,
  QuantityStatus,
} from "../domain/measurement-repository";
import { toCaptureWithQuantities, type RoomCaptureRow } from "./measurement-mapper";

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
      .orderBy(desc(roomCaptures.capturedAt));

    if (rows.length === 0) return [];
    return this.attachQuantities(rows);
  }

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
    await this.tx
      .update(roomCaptures)
      .set({ supersededById: next.props.id, updatedAt: new Date() })
      .where(and(eq(roomCaptures.id, oldId), eq(roomCaptures.orgId, this.orgId), isNull(roomCaptures.deletedAt)));

    await this.insertCaptureWithQuantities(next, quantities);
  }

  async setQuantity(
    captureId: string,
    kind: PaintingQuantityKind,
    patch: { value: number | null; status: QuantityStatus },
  ): Promise<void> {
    // derivedValue is deliberately absent from the SET clause — it is immutable once persisted.
    await this.tx
      .update(paintingRoomQuantities)
      .set({ value: patch.value, status: patch.status, updatedAt: new Date() })
      .where(
        and(
          eq(paintingRoomQuantities.captureId, captureId),
          eq(paintingRoomQuantities.kind, kind),
          eq(paintingRoomQuantities.orgId, this.orgId),
        ),
      );
  }

  async renameRoom(captureId: string, roomName: string): Promise<void> {
    await this.tx
      .update(roomCaptures)
      .set({ roomName, updatedAt: new Date() })
      .where(and(eq(roomCaptures.id, captureId), eq(roomCaptures.orgId, this.orgId), isNull(roomCaptures.deletedAt)));
  }

  async archive(captureId: string): Promise<void> {
    const now = new Date();
    await this.tx
      .update(roomCaptures)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(eq(roomCaptures.id, captureId), eq(roomCaptures.orgId, this.orgId), isNull(roomCaptures.deletedAt)));
  }

  // Inserts a capture row and its quantity rows on `this.tx` — the caller (createCapture /
  // supersede) is already running inside a single transaction (withTenant), so this method
  // never opens its own transaction; it just keeps the two-table write co-located.
  private async insertCaptureWithQuantities(
    capture: RoomCapture,
    quantities: readonly PaintingQuantity[],
  ): Promise<void> {
    const p = capture.props;
    const rows = await this.tx
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
      .returning();
    const row = rows[0];
    if (!row) throw new Error("room_capture insert returned no row");

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
}
