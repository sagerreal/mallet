import { and, eq, isNull } from "drizzle-orm";
import type { TenantTx } from "@mallet/shared/db/tx";
import { inboundEndpoints } from "@mallet/shared/db/schema";
import type { OrgId } from "@mallet/shared/types";
import type { InboundEndpointRepository } from "../domain/inbound-ports";
import type { Channel } from "../domain/channel";
import type { InboundEndpoint } from "../domain/inbound-endpoint";
import { rowToInboundEndpoint } from "./inbound-mapper";

// Org-scoped repo (runs under withTenant, so RLS already appends org_id = current_org_id()).
// Every query still adds an explicit eq(orgId) — defense-in-depth beyond RLS, and keeps the
// (org_id, channel) unique index in play for conflict targets.
export class DrizzleInboundEndpointRepository implements InboundEndpointRepository {
  constructor(
    private readonly tx: TenantTx,
    private readonly orgId: OrgId,
  ) {}

  async listByOrg(): Promise<InboundEndpoint[]> {
    const rows = await this.tx
      .select()
      .from(inboundEndpoints)
      .where(and(eq(inboundEndpoints.orgId, this.orgId), isNull(inboundEndpoints.deletedAt)));
    return rows.map(rowToInboundEndpoint);
  }

  async findByChannel(channel: Channel): Promise<InboundEndpoint | null> {
    const rows = await this.tx
      .select()
      .from(inboundEndpoints)
      .where(
        and(
          eq(inboundEndpoints.orgId, this.orgId),
          eq(inboundEndpoints.channel, channel),
          isNull(inboundEndpoints.deletedAt),
        ),
      )
      .limit(1);
    const row = rows[0];
    return row ? rowToInboundEndpoint(row) : null;
  }

  async create(channel: Channel, token: string): Promise<InboundEndpoint> {
    // Idempotent per (org, channel): a conflict means this channel already has a row (active
    // or soft-deleted) — revive it rather than erroring. Callers check findByChannel first for
    // the "already connected" case, so this path is chiefly for reviving a deleted endpoint.
    const [row] = await this.tx
      .insert(inboundEndpoints)
      .values({ orgId: this.orgId, channel, token })
      .onConflictDoUpdate({
        target: [inboundEndpoints.orgId, inboundEndpoints.channel],
        set: { deletedAt: null },
      })
      .returning();
    if (!row) throw new Error("create: insert...onConflictDoUpdate returned no row");
    return rowToInboundEndpoint(row);
  }

  async rotateToken(channel: Channel, token: string): Promise<InboundEndpoint | null> {
    const [row] = await this.tx
      .update(inboundEndpoints)
      .set({ token })
      .where(
        and(
          eq(inboundEndpoints.orgId, this.orgId),
          eq(inboundEndpoints.channel, channel),
          isNull(inboundEndpoints.deletedAt),
        ),
      )
      .returning();
    return row ? rowToInboundEndpoint(row) : null;
  }

  async softDelete(channel: Channel): Promise<void> {
    await this.tx
      .update(inboundEndpoints)
      .set({ deletedAt: new Date() })
      .where(and(eq(inboundEndpoints.orgId, this.orgId), eq(inboundEndpoints.channel, channel)));
  }

  async touchLastLead(channel: Channel, at: Date): Promise<void> {
    await this.tx
      .update(inboundEndpoints)
      .set({ lastLeadAt: at })
      .where(and(eq(inboundEndpoints.orgId, this.orgId), eq(inboundEndpoints.channel, channel)));
  }
}
