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

// Idempotency ledger used as a LOCK (record-first): reserve the (channel, externalId) BEFORE the
// create so a retried/duplicate webhook can't double-create. release() rolls back a reservation
// when the create fails, so a genuine retry can proceed.
export interface LeadReceiptRepository {
  reserve(channel: Channel, externalId: string): Promise<boolean>; // true = newly reserved (proceed)
  release(channel: Channel, externalId: string): Promise<void>;
}

// Privileged, pre-tenant token→org lookup (BYPASSRLS ownerDb). Returns minimal identity only.
export interface InboundEndpointResolver {
  resolve(token: string): Promise<{ orgId: OrgId; channel: Channel } | null>;
}
