import { and, eq, inArray, desc } from "drizzle-orm";
import { qboEntityLinks, qboSyncLog } from "@mallet/shared/db/schema";
import type { TenantTx } from "@mallet/shared/db/tx";
import type { OrgId } from "@mallet/shared/types";
import type {
  QboEntityLink,
  QboEntityLinkRepository,
  QboSyncLogEntry,
  QboSyncLogRepository,
  SyncOutcome,
} from "../domain/qbo-sync-repositories";

export class DrizzleQboEntityLinkRepository implements QboEntityLinkRepository {
  constructor(
    private readonly tx: TenantTx,
    private readonly orgId: OrgId,
  ) {}

  async listByType(entityType: QboEntityLink["entityType"]): Promise<readonly QboEntityLink[]> {
    const rows = await this.tx
      .select()
      .from(qboEntityLinks)
      .where(and(eq(qboEntityLinks.orgId, this.orgId), eq(qboEntityLinks.entityType, entityType)));
    return rows.map(toLink);
  }

  async find(
    entityType: QboEntityLink["entityType"],
    malletId: string,
  ): Promise<QboEntityLink | null> {
    const [row] = await this.tx
      .select()
      .from(qboEntityLinks)
      .where(
        and(
          eq(qboEntityLinks.orgId, this.orgId),
          eq(qboEntityLinks.entityType, entityType),
          eq(qboEntityLinks.malletId, malletId),
        ),
      )
      .limit(1);
    return row ? toLink(row) : null;
  }

  async save(link: QboEntityLink): Promise<void> {
    const values = {
      orgId: this.orgId,
      entityType: link.entityType,
      malletId: link.malletId,
      qboId: link.qboId,
      qboEntityKind: link.qboEntityKind,
      displayName: link.displayName,
      updatedAt: new Date(),
    };
    await this.tx
      .insert(qboEntityLinks)
      .values(values)
      .onConflictDoUpdate({
        target: [qboEntityLinks.orgId, qboEntityLinks.entityType, qboEntityLinks.malletId],
        set: {
          qboId: values.qboId,
          qboEntityKind: values.qboEntityKind,
          displayName: values.displayName,
          updatedAt: values.updatedAt,
        },
      });
  }

  async remove(entityType: QboEntityLink["entityType"], malletId: string): Promise<void> {
    await this.tx
      .delete(qboEntityLinks)
      .where(
        and(
          eq(qboEntityLinks.orgId, this.orgId),
          eq(qboEntityLinks.entityType, entityType),
          eq(qboEntityLinks.malletId, malletId),
        ),
      );
  }
}

export class DrizzleQboSyncLogRepository implements QboSyncLogRepository {
  constructor(
    private readonly tx: TenantTx,
    private readonly orgId: OrgId,
  ) {}

  async succeededIds(
    entityType: string,
    malletIds: readonly string[],
  ): Promise<ReadonlySet<string>> {
    if (malletIds.length === 0) return new Set();
    const rows = await this.tx
      .select({ malletId: qboSyncLog.malletId })
      .from(qboSyncLog)
      .where(
        and(
          eq(qboSyncLog.orgId, this.orgId),
          eq(qboSyncLog.entityType, entityType),
          eq(qboSyncLog.status, "succeeded"),
          inArray(qboSyncLog.malletId, [...malletIds]),
        ),
      );
    return new Set(rows.map((r) => r.malletId));
  }

  async record(entry: QboSyncLogEntry): Promise<void> {
    await this.tx.insert(qboSyncLog).values({
      orgId: this.orgId,
      entityType: entry.entityType,
      malletId: entry.malletId,
      qboId: entry.qboId,
      status: entry.status,
      errorCode: entry.errorCode,
      errorMessage: entry.errorMessage,
      attemptedAt: entry.attemptedAt,
    });
  }

  async recent(limit: number): Promise<readonly QboSyncLogEntry[]> {
    const rows = await this.tx
      .select()
      .from(qboSyncLog)
      .where(eq(qboSyncLog.orgId, this.orgId))
      .orderBy(desc(qboSyncLog.attemptedAt))
      .limit(limit);
    return rows.map((r) => ({
      entityType: r.entityType,
      malletId: r.malletId,
      qboId: r.qboId,
      status: r.status as SyncOutcome,
      errorCode: r.errorCode,
      errorMessage: r.errorMessage,
      attemptedAt: r.attemptedAt,
    }));
  }
}

const toLink = (row: {
  entityType: string;
  malletId: string;
  qboId: string;
  qboEntityKind: string | null;
  displayName: string | null;
}): QboEntityLink => ({
  entityType: row.entityType as QboEntityLink["entityType"],
  malletId: row.malletId,
  qboId: row.qboId,
  qboEntityKind: row.qboEntityKind as QboEntityLink["qboEntityKind"],
  displayName: row.displayName,
});
