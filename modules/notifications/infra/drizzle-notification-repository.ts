import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { notifications } from "@mallet/shared/db/schema";
import type { TenantTx } from "@mallet/shared/db/tx";
import {
  buildPage,
  decodeCursor,
  isOk,
  type OrgId,
  type CursorPage,
  type Paginated,
} from "@mallet/shared/types";
import type { Notification, RelatedType } from "../domain/notification";
import type { NotificationRepository, NotificationFilter } from "../domain/notification-repository";
import { toDomain, toInsertValues } from "./notification-mapper";

export class DrizzleNotificationRepository implements NotificationRepository {
  constructor(
    private readonly tx: TenantTx,
    private readonly orgId: OrgId,
  ) {}

  async insert(notification: Notification): Promise<boolean> {
    const inserted = await this.tx
      .insert(notifications)
      .values(toInsertValues(notification))
      .onConflictDoNothing({ target: [notifications.orgId, notifications.idempotencyKey] })
      .returning({ id: notifications.id });
    return inserted.length > 0;
  }

  async markSent(id: string, externalId: string | null, sentAt: Date): Promise<Notification | null> {
    await this.tx
      .update(notifications)
      .set({ status: "sent", externalId, sentAt })
      .where(and(eq(notifications.id, id), eq(notifications.status, "queued")));
    return this.findById(id);
  }

  async markFailed(id: string, error: string): Promise<Notification | null> {
    await this.tx
      .update(notifications)
      .set({ status: "failed", error })
      .where(and(eq(notifications.id, id), eq(notifications.status, "queued")));
    return this.findById(id);
  }

  async findById(id: string): Promise<Notification | null> {
    const rows = await this.tx.select().from(notifications).where(eq(notifications.id, id)).limit(1);
    const row = rows[0];
    return row ? toDomain(row) : null;
  }

  async findByIdempotencyKey(key: string): Promise<Notification | null> {
    const rows = await this.tx
      .select()
      .from(notifications)
      .where(eq(notifications.idempotencyKey, key))
      .limit(1);
    const row = rows[0];
    return row ? toDomain(row) : null;
  }

  async sentReminderStages(
    relatedType: RelatedType,
    relatedIds: readonly string[],
  ): Promise<Map<string, number[]>> {
    const map = new Map<string, number[]>();
    if (relatedIds.length === 0) return map;
    const col = relatedType === "invoice" ? notifications.relatedInvoiceId : notifications.relatedEstimateId;
    // Only DELIVERED stages count — a 'failed' stage is not "sent", so it stays eligible (a retry
    // worker re-drives failed rows by id; the deterministic reminder key is already consumed).
    const rows = await this.tx
      .select({ relatedId: col, stage: notifications.reminderStage })
      .from(notifications)
      .where(
        and(
          inArray(col, [...relatedIds]),
          sql`${notifications.reminderStage} is not null`,
          eq(notifications.status, "sent"),
        ),
      );
    for (const row of rows) {
      if (row.relatedId === null || row.stage === null) continue;
      map.set(row.relatedId, [...(map.get(row.relatedId) ?? []), row.stage]);
    }
    return map;
  }

  async list(page: CursorPage, filter?: NotificationFilter): Promise<Paginated<Notification>> {
    const conds: SQL[] = [];
    if (filter?.channel) conds.push(eq(notifications.channel, filter.channel));
    if (filter?.status) conds.push(eq(notifications.status, filter.status));
    if (filter?.kind) conds.push(eq(notifications.kind, filter.kind));
    if (page.cursor) {
      const cursor = decodeCursor(page.cursor);
      if (isOk(cursor)) {
        conds.push(
          sql`(${notifications.createdAt}, ${notifications.id}) < (${cursor.value.createdAt}::timestamptz, ${cursor.value.id}::uuid)`,
        );
      }
    }
    const rows = await this.tx
      .select()
      .from(notifications)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(page.limit + 1);
    return buildPage(rows.map(toDomain), page, (n) => ({
      createdAt: n.props.createdAt,
      id: n.props.id,
    }));
  }
}
