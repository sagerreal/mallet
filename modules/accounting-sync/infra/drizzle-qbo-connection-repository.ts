import { eq } from "drizzle-orm";
import { qboConnections } from "@mallet/shared/db/schema";
import type { TenantTx } from "@mallet/shared/db/tx";
import type { OrgId } from "@mallet/shared/types";
import type { QboConnection } from "../domain/qbo-connection";
import type { QboConnectionRepository } from "../domain/qbo-connection-repository";
import { toDomain, toRow } from "./qbo-connection-mapper";

// Real persistence. Constructed with a tenant-scoped transaction (withTenant already set
// app.current_org_id), so RLS scopes every statement to this org; the explicit eq(orgId) is
// defence-in-depth and keeps the unique index in play.
export class DrizzleQboConnectionRepository implements QboConnectionRepository {
  constructor(
    private readonly tx: TenantTx,
    private readonly orgId: OrgId,
  ) {}

  async get(): Promise<QboConnection | null> {
    const [row] = await this.tx
      .select()
      .from(qboConnections)
      .where(eq(qboConnections.orgId, this.orgId))
      .limit(1);
    return row ? toDomain(row) : null;
  }

  // FOR UPDATE holds the row until this transaction commits, serialising concurrent refreshes.
  // See QboConnectionRepository.getForUpdate for why that matters (rotated refresh tokens).
  async getForUpdate(): Promise<QboConnection | null> {
    const [row] = await this.tx
      .select()
      .from(qboConnections)
      .where(eq(qboConnections.orgId, this.orgId))
      .limit(1)
      .for("update");
    return row ? toDomain(row) : null;
  }

  async save(connection: QboConnection): Promise<void> {
    const row = toRow(connection);
    await this.tx
      .insert(qboConnections)
      .values(row)
      // One connection per org (qbo_connections_org_uidx): reconnecting updates in place rather
      // than stacking rows. id/createdAt are deliberately not in the update set — a reconnect
      // keeps the original row identity.
      .onConflictDoUpdate({
        target: qboConnections.orgId,
        set: {
          realmId: row.realmId,
          accessTokenSealed: row.accessTokenSealed,
          refreshTokenSealed: row.refreshTokenSealed,
          accessExpiresAt: row.accessExpiresAt,
          refreshExpiresAt: row.refreshExpiresAt,
          status: row.status,
          connectedByUserId: row.connectedByUserId,
          lastSyncAt: row.lastSyncAt,
          defaultItemQboId: row.defaultItemQboId,
          defaultItemName: row.defaultItemName,
          sendApprovedHours: row.sendApprovedHours,
          updatedAt: row.updatedAt,
          disconnectedAt: row.disconnectedAt,
        },
      });
  }
}
