import { and, eq, isNotNull } from "drizzle-orm";
import { ownerDb } from "@mallet/shared/db/owner-client";
import type { TenantTx } from "@mallet/shared/db/tx";
import { users, staffSmsSessions } from "@mallet/shared/db/schema";
import { asOrgId, type OrgId, type UserId } from "@mallet/shared/types";
import type { Role } from "@mallet/identity";
import type {
  StaffByPhoneReader,
  StaffIdentity,
  SmsSession,
  SmsSessionStore,
  SaveSessionInput,
} from "../domain/ports";

// Both readers filter on orgId explicitly as well as relying on RLS — defence in depth, and it is
// what lets the index actually be used (the house rule from CLAUDE.md).

// PRIVILEGED, and deliberately so. Every shop's staff texts one shared Mallet assistant number, so
// when this runs there is no tenant yet — the sender's number is what establishes it. Same shape as
// DrizzleOrgByNumberReader: read as the owner role, return ONLY identity, and let every subsequent
// read run inside withTenant on the org this hands back.
export class DrizzleStaffByPhoneReader implements StaffByPhoneReader {
  async findStaffByPhone(phoneE164: string): Promise<StaffIdentity | null> {
    // isNotNull(callbackVerifiedAt) is the security boundary, not a nicety. An unverified
    // callback_number is self-asserted, and users_verified_callback_uidx only constrains VERIFIED
    // rows — matching unverified ones would reintroduce exactly the ambiguity that index exists to
    // remove, with a coin flip deciding whose books an inbound command writes to.
    const rows = await ownerDb
      .select({ id: users.id, orgId: users.orgId, role: users.role, name: users.name })
      .from(users)
      .where(and(eq(users.callbackNumber, phoneE164), isNotNull(users.callbackVerifiedAt)))
      .limit(2);

    // The unique index makes two rows impossible, so this is an assertion rather than a policy: if
    // it ever fires the index is gone, and we must NOT guess which staffer — or which SHOP — to
    // act as.
    if (rows.length !== 1) return null;

    const row = rows[0]!;
    return {
      userId: row.id as UserId,
      orgId: asOrgId(row.orgId),
      role: row.role as Role,
      name: row.name ?? null,
    };
  }
}

const parseIds = (raw: string | null): readonly string[] => {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    // Defensive: this column is written by us, but a malformed value must degrade to "nothing
    // pending" rather than throw inside a webhook and lose the message.
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
};

export class DrizzleSmsSessionStore implements SmsSessionStore {
  constructor(
    private readonly tx: TenantTx,
    private readonly orgId: OrgId,
    private readonly newId: () => string,
  ) {}

  async find(phoneE164: string): Promise<SmsSession | null> {
    const rows = await this.tx
      .select()
      .from(staffSmsSessions)
      .where(and(eq(staffSmsSessions.orgId, this.orgId), eq(staffSmsSessions.phone, phoneE164)))
      .limit(1);

    const row = rows[0];
    if (!row) return null;
    return {
      userId: row.userId as UserId,
      phone: row.phone,
      transcript: row.transcript,
      pendingToolUseIds: parseIds(row.pendingJson),
      pendingSummary: row.pendingSummary,
    };
  }

  async save(input: SaveSessionInput): Promise<void> {
    const now = new Date();
    await this.tx
      .insert(staffSmsSessions)
      .values({
        id: this.newId(),
        orgId: this.orgId,
        userId: input.userId,
        phone: input.phone,
        transcript: input.transcript,
        pendingJson: JSON.stringify(input.pendingToolUseIds),
        pendingSummary: input.pendingSummary,
        lastMessageAt: now,
        updatedAt: now,
      })
      // One live conversation per staffer per org — a second text continues it rather than
      // starting a parallel one the agent would have no memory of.
      .onConflictDoUpdate({
        target: [staffSmsSessions.orgId, staffSmsSessions.phone],
        set: {
          userId: input.userId,
          transcript: input.transcript,
          pendingJson: JSON.stringify(input.pendingToolUseIds),
          pendingSummary: input.pendingSummary,
          lastMessageAt: now,
          updatedAt: now,
        },
      });
  }
}
