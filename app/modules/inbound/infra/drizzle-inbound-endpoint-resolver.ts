import { and, eq, isNull } from "drizzle-orm";
import { ownerDb } from "@mallet/shared/db/owner-client";
import { inboundEndpoints } from "@mallet/shared/db/schema";
import { asOrgId, type OrgId } from "@mallet/shared/types";
import { isChannel, type Channel } from "../domain/channel";
import type { InboundEndpointResolver } from "../domain/inbound-ports";

// Pre-tenant token→org lookup on ownerDb (BYPASSRLS) — the caller has no session; the
// unguessable 64-hex token is the sole credential. Returns ONLY { orgId, channel }; never
// accepts an org id from the caller. All writes after this re-enter withTenant.
// Mirrors DrizzlePublicEstimateReader (quoting module).
export class DrizzleInboundEndpointResolver implements InboundEndpointResolver {
  async resolve(token: string): Promise<{ orgId: OrgId; channel: Channel } | null> {
    const rows = await ownerDb
      .select({ orgId: inboundEndpoints.orgId, channel: inboundEndpoints.channel })
      .from(inboundEndpoints)
      .where(and(eq(inboundEndpoints.token, token), isNull(inboundEndpoints.deletedAt)))
      .limit(1);

    const row = rows[0];
    if (!row || !isChannel(row.channel)) return null;
    return { orgId: asOrgId(row.orgId), channel: row.channel };
  }
}
