import type { LeadId, UserId, Phone } from "@mallet/shared/types";

// The three lookups placing a call needs, kept as separate ports (ISP) so a use-case that
// only reads one of them cannot be handed the others. All are org-scoped by construction.

export interface LeadPhoneReader {
  // Null when the lead has no phone on file — the call must be refused, not attempted.
  findPhone(leadId: LeadId): Promise<Phone | null>;
}

export interface OrgLineReader {
  // The org's provisioned business number, used as the caller ID the customer sees.
  // Null when no number has been provisioned yet.
  businessNumber(): Promise<Phone | null>;
}

export interface AgentNumberStore {
  // The caller's own mobile — the leg Twilio rings first.
  find(userId: UserId): Promise<Phone | null>;
  // Remembered on first use so the office does not retype it on every call. Null CLEARS it: a
  // person who removes their number must end up with no number, not with the old one still stored.
  save(userId: UserId, number: Phone | null): Promise<void>;
}
