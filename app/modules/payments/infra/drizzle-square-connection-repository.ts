import { and, eq, isNull } from "drizzle-orm";
import { squareConnections } from "@mallet/shared/db/schema";
import type { TenantTx } from "@mallet/shared/db/tx";
import type { Result, AppError } from "@mallet/shared/types";
import { ok, err, externalService } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import type {
  SquareConnectionRepository,
  SquareConnectionRow,
  UpsertSquareConnectionCmd,
} from "../domain/square-connection-repository";

type Row = typeof squareConnections.$inferSelect;

// Tokens stay SEALED across this boundary — the mapper never unseals, and nothing here logs a
// token column. The only place plaintext exists is inside a use case, between the gateway
// returning it and the secret box sealing it.
const toDomain = (row: Row): SquareConnectionRow => ({
  id: row.id,
  merchantId: row.merchantId,
  locationId: row.locationId,
  accessTokenSealed: row.accessTokenSealed,
  refreshTokenSealed: row.refreshTokenSealed,
  accessExpiresAt: row.accessExpiresAt,
  status: row.status === "disconnected" || row.status === "expired" ? row.status : "active",
  scopes: row.scopes,
});

export class DrizzleSquareConnectionRepository implements SquareConnectionRepository {
  constructor(
    private readonly tx: TenantTx,
    private readonly orgId: string,
  ) {}

  private get live() {
    return and(eq(squareConnections.orgId, this.orgId), isNull(squareConnections.deletedAt));
  }

  async findLive(): Promise<SquareConnectionRow | null> {
    const rows = await this.tx.select().from(squareConnections).where(this.live).limit(1);
    const row = rows[0];
    return row ? toDomain(row) : null;
  }

  async upsert(cmd: UpsertSquareConnectionCmd): Promise<Result<SquareConnectionRow, AppError>> {
    // RECONNECT REPLACES. A shop that reconnects a different merchant must not end up with two
    // live rows and no way to tell which one takes the money — the partial unique index would
    // reject the insert anyway, so the old row is retired first, in the same tx.
    await this.tx
      .update(squareConnections)
      .set({ deletedAt: new Date(), status: "disconnected", updatedAt: new Date() })
      .where(this.live);

    try {
      const inserted = await this.tx
        .insert(squareConnections)
        .values({
          orgId: this.orgId,
          merchantId: cmd.merchantId,
          accessTokenSealed: cmd.accessTokenSealed,
          refreshTokenSealed: cmd.refreshTokenSealed,
          accessExpiresAt: cmd.accessExpiresAt,
          scopes: cmd.scopes,
          connectedByUserId: cmd.connectedByUserId,
          status: "active",
        })
        .returning();
      const row = inserted[0];
      if (!row) return err(externalService("database", "could not save the Square connection", true));
      return ok(toDomain(row));
    } catch (e: unknown) {
      // Deliberately message-only: the values in flight are sealed tokens.
      logger.error(
        { err: e instanceof Error ? e.message : String(e), orgId: this.orgId },
        "square.connection.upsert_failed",
      );
      return err(externalService("database", "could not save the Square connection", true));
    }
  }

  async disconnect(): Promise<number> {
    const rows = await this.tx
      .update(squareConnections)
      .set({ deletedAt: new Date(), status: "disconnected", updatedAt: new Date() })
      .where(this.live)
      .returning();
    return rows.length;
  }

  async setLocation(locationId: string): Promise<number> {
    const rows = await this.tx
      .update(squareConnections)
      .set({ locationId, updatedAt: new Date() })
      .where(this.live)
      .returning();
    return rows.length;
  }

  async updateTokens(cmd: {
    accessTokenSealed: string;
    refreshTokenSealed: string;
    accessExpiresAt: Date;
  }): Promise<number> {
    // BOTH halves, always. Square rotates the refresh token on use and invalidates the old value,
    // so writing only the access token leaves a connection that dies at its next renewal.
    const rows = await this.tx
      .update(squareConnections)
      .set({ ...cmd, status: "active", updatedAt: new Date() })
      .where(this.live)
      .returning();
    return rows.length;
  }
}
