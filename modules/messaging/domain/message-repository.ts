import type { OrgId, LeadId, MessageId } from "@mallet/shared/types";
import type { DeliveryStatus } from "./delivery-status";
import type { Message } from "./message";
import type { MessageDirection } from "./message";

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

// One row per lead: the lead's name/phone/unread flag plus the most-recent non-deleted
// message. Returned by listConversations(); sorted by lastAt DESC (newest thread first).
// phone rides along so the inbox can disable phone-dependent controls when a lead's
// number was removed after the thread started (null = none on file).
export interface ConversationRow {
  readonly leadId: LeadId;
  readonly leadName: string;
  readonly phone: string | null;
  readonly lastBody: string;
  readonly lastDirection: MessageDirection;
  readonly lastAt: Date;
  readonly unread: boolean;
}

// Port for the messages persistence surface. All implementations are org-scoped.
export interface MessageRepository {
  recordOutbound(input: RecordOutboundInput): Promise<Message>;
  recordInbound(input: RecordInboundInput): Promise<Message>;
  listByLead(leadId: LeadId, page: { limit: number; offset: number }): Promise<Message[]>;
  findById(id: MessageId): Promise<Message | null>;
  /**
   * Record what the carrier said about an outbound message, found by its provider SID.
   *
   * Returns false when nothing was written — an unknown SID, or a callback that would move the
   * message BACKWARDS (Twilio does not guarantee callback ordering, and a late `sent` must not
   * un-deliver a message that plainly arrived).
   */
  applyProviderStatus(input: {
    providerSid: string;
    status: DeliveryStatus;
    errorCode: string | null;
    at: Date;
  }): Promise<boolean>;
  // One efficient query — no N+1. Returns one ConversationRow per lead that has at least
  // one non-deleted message, sorted newest-first. An optional leadId filter is reserved for
  // a future tech-scoping pass; pass undefined (default) for all leads in the org.
  listConversations(filter?: { leadId?: LeadId }): Promise<ConversationRow[]>;
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
