import type { OrgId, LeadId, MessageId } from "@mallet/shared/types";
import type { Message } from "./message";

export interface RecordOutboundInput {
  readonly id: string;
  readonly orgId: OrgId;
  readonly leadId: LeadId | null;
  readonly body: string;
  readonly fromNumber: string;
  readonly toNumber: string;
  readonly providerSid: string | null;
  readonly status: "queued" | "sent" | "failed";
}

export interface RecordInboundInput {
  readonly id: string;
  readonly orgId: OrgId;
  readonly leadId: LeadId | null;
  readonly body: string;
  readonly fromNumber: string;
  readonly toNumber: string;
  readonly providerSid: string | null;
}

// Port for the messages persistence surface. All implementations are org-scoped.
export interface MessageRepository {
  recordOutbound(input: RecordOutboundInput): Promise<Message>;
  recordInbound(input: RecordInboundInput): Promise<Message>;
  listByLead(leadId: LeadId, page: { limit: number; offset: number }): Promise<Message[]>;
  findById(id: MessageId): Promise<Message | null>;
}

// Unprivileged reader used by the inbound webhook to resolve which org owns a Twilio To-number.
// NOT org-scoped — the webhook has no principal yet; it looks up org by number then scopes all
// further work to that org via withTenant.
export interface OrgByNumberReader {
  findOrgIdByTwilioNumber(twilioNumber: string): Promise<OrgId | null>;
}

// Reader used within a tenant tx to find a lead by their phone number (inbound matching).
export interface LeadByPhoneReader {
  findLeadByPhone(phoneE164: string): Promise<{ leadId: LeadId } | null>;
}

// Writer used within a tenant tx to mark a lead unread when an inbound message arrives.
// Idempotent: already-unread leads are a no-op (returns false); returns true when the flag was set.
export interface LeadUnreadMarker {
  markLeadUnread(leadId: LeadId, now: Date): Promise<boolean>;
}
