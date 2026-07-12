import type { OrgId } from "@mallet/shared/types";
import type { Channel } from "./channel";
import type { InboundEndpoint } from "./inbound-endpoint";

// Org-scoped repo (runs under withTenant). Minting is idempotent per (org, channel).
export interface InboundEndpointRepository {
  listByOrg(): Promise<InboundEndpoint[]>;
  findByChannel(channel: Channel): Promise<InboundEndpoint | null>;
  create(channel: Channel, token: string): Promise<InboundEndpoint>;
  rotateToken(channel: Channel, token: string): Promise<InboundEndpoint | null>;
  softDelete(channel: Channel): Promise<void>;
  touchLastLead(channel: Channel, at: Date): Promise<void>;
}

// Idempotency ledger (runs under withTenant). Returns false if (channel, externalId) already seen.
export interface LeadReceiptRepository {
  recordIfNew(channel: Channel, externalId: string, leadId: string): Promise<boolean>;
}

// Privileged, pre-tenant token→org lookup (BYPASSRLS ownerDb). Returns minimal identity only.
export interface InboundEndpointResolver {
  resolve(token: string): Promise<{ orgId: OrgId; channel: Channel } | null>;
}
