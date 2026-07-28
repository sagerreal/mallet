import type { OrgId, UserId } from "@mallet/shared/types";
import type { Role } from "@mallet/identity";

/**
 * A staffer identified by the mobile an inbound text arrived from.
 *
 * Carries the ORG because every shop's staff texts one shared Mallet assistant number — so the
 * To-number cannot say which shop a message belongs to, and the sender's verified mobile is the
 * only thing that resolves both the person and their tenant.
 */
export interface StaffIdentity {
  readonly userId: UserId;
  readonly orgId: OrgId;
  readonly role: Role;
  readonly name: string | null;
}

/**
 * Resolve an inbound From-number to a staff member — ACROSS all orgs.
 *
 * This runs before any tenant is known, so implementations read privileged (the same reason
 * DrizzleOrgByNumberReader does) and MUST return only the identity, never tenant data. Every read
 * after this point runs inside withTenant on the org it returns.
 *
 * Implementations MUST match only numbers whose ownership has been proven (users.callback_verified_at
 * set). An unverified callback_number is a value someone typed into a settings box with no OTP and
 * no ownership proof — adequate for "ring me here", not for deciding whose books an inbound command
 * may write to.
 */
export interface StaffByPhoneReader {
  findStaffByPhone(phoneE164: string): Promise<StaffIdentity | null>;
}

/** A live text conversation between one staffer and the agent. */
export interface SmsSession {
  readonly userId: UserId;
  readonly phone: string;
  /** Opaque agent transcript, exactly as runAgentTurn returned it. Null on a fresh conversation. */
  readonly transcript: string | null;
  /** Tool-use ids the agent is waiting on. Empty means no question is outstanding. */
  readonly pendingToolUseIds: readonly string[];
  /** What the agent said it would do, so a late "yes" can be answered in the same words. */
  readonly pendingSummary: string | null;
}

export interface SaveSessionInput {
  readonly userId: UserId;
  readonly phone: string;
  readonly transcript: string | null;
  readonly pendingToolUseIds: readonly string[];
  readonly pendingSummary: string | null;
}

export interface SmsSessionStore {
  /** The live session for this phone, or null if the staffer has never texted. */
  find(phoneE164: string): Promise<SmsSession | null>;
  /** Upsert on (org, phone) — one live conversation per staffer. */
  save(input: SaveSessionInput): Promise<void>;
}

/** Sends the agent's answer back to the staffer, from the org's own business number. */
export interface StaffReplySender {
  send(input: { orgId: OrgId; toPhone: string; body: string }): Promise<void>;
}
