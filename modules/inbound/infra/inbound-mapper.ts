import { asOrgId } from "@mallet/shared/types";
import { inboundEndpoints } from "@mallet/shared/db/schema";
import { InboundEndpoint } from "../domain/inbound-endpoint";
import { isChannel } from "../domain/channel";

// The persistence row shape, inferred from the schema. Kept distinct from the domain type:
// the mapper is the only place that knows both.
export type InboundEndpointRow = typeof inboundEndpoints.$inferSelect;

// Reconstruct a domain InboundEndpoint from a DB row. A row that fails domain invariants
// (unknown channel, malformed token) is corrupt data, not an expected condition — fail loud
// rather than silently coerce.
export function rowToInboundEndpoint(row: InboundEndpointRow): InboundEndpoint {
  if (!isChannel(row.channel)) {
    throw new Error(`corrupt inbound_endpoints.channel: ${row.channel}`);
  }
  const result = InboundEndpoint.create({
    id: row.id,
    orgId: asOrgId(row.orgId),
    channel: row.channel,
    token: row.token,
    lastLeadAt: row.lastLeadAt,
    createdAt: row.createdAt,
  });
  if (!result.ok) {
    throw new Error(`corrupt inbound_endpoint ${row.id}: ${result.error.message}`);
  }
  return result.value;
}
