import { and, eq, isNull } from "drizzle-orm";
import { leads, orgs, users, outboundCalls } from "@mallet/shared/db/schema";
import type { TenantTx } from "@mallet/shared/db/tx";
import { ownerDb } from "@mallet/shared/db/owner-client";
import type { OrgId, LeadId, UserId, Phone } from "@mallet/shared/types";
import { asOrgId, asPhone } from "@mallet/shared/types";
import type { LeadPhoneReader, OrgLineReader, AgentNumberStore } from "../domain/call-directory";

// Org-scoped readers — all run inside a withTenant tx. RLS enforces the tenant boundary at the
// session level; the explicit eq(orgId) adds defense-in-depth and keeps the org-leading indexes
// in use.

export class DrizzleLeadPhoneReader implements LeadPhoneReader {
  constructor(
    private readonly tx: TenantTx,
    private readonly orgId: OrgId,
  ) {}

  async findPhone(leadId: LeadId): Promise<Phone | null> {
    const rows = await this.tx
      .select({ phone: leads.phoneE164 })
      .from(leads)
      .where(and(eq(leads.orgId, this.orgId), eq(leads.id, leadId), isNull(leads.deletedAt)))
      .limit(1);
    const phone = rows[0]?.phone;
    return phone ? asPhone(phone) : null;
  }
}

export class DrizzleOrgLineReader implements OrgLineReader {
  constructor(
    private readonly tx: TenantTx,
    private readonly orgId: OrgId,
  ) {}

  async businessNumber(): Promise<Phone | null> {
    const rows = await this.tx
      .select({ number: orgs.twilioNumber })
      .from(orgs)
      .where(eq(orgs.id, this.orgId))
      .limit(1);
    const number = rows[0]?.number;
    return number ? asPhone(number) : null;
  }
}

export class DrizzleAgentNumberStore implements AgentNumberStore {
  constructor(
    private readonly tx: TenantTx,
    private readonly orgId: OrgId,
  ) {}

  async find(userId: UserId): Promise<Phone | null> {
    const rows = await this.tx
      .select({ number: users.callbackNumber })
      .from(users)
      .where(and(eq(users.orgId, this.orgId), eq(users.id, userId)))
      .limit(1);
    const number = rows[0]?.number;
    return number ? asPhone(number) : null;
  }

  async save(userId: UserId, number: Phone): Promise<void> {
    await this.tx
      .update(users)
      .set({ callbackNumber: number })
      .where(and(eq(users.orgId, this.orgId), eq(users.id, userId)));
  }
}

// Privileged reader for the voice webhooks. Uses ownerDb (the BYPASSRLS role) because no RLS
// context exists yet — a Twilio callback carries a CallSid, not a principal. It returns ONLY an
// OrgId, the minimum needed to open the correct tenant transaction; every subsequent read and
// write happens under withTenant with RLS enforced.
export class DrizzleOrgByCallSidReader {
  async findOrgIdByProviderCallSid(providerCallSid: string): Promise<OrgId | null> {
    const rows = await ownerDb
      .select({ orgId: outboundCalls.orgId })
      .from(outboundCalls)
      .where(eq(outboundCalls.providerCallSid, providerCallSid))
      .limit(1);
    const row = rows[0];
    return row ? asOrgId(row.orgId) : null;
  }
}

// Privileged reader for the TwiML route: resolves the org that owns a call id, so the route can
// open the right tenant transaction and read the destination under RLS. Returns only the OrgId.
export class DrizzleOrgByCallIdReader {
  async findOrgIdByCallId(callId: string): Promise<OrgId | null> {
    const rows = await ownerDb
      .select({ orgId: outboundCalls.orgId })
      .from(outboundCalls)
      .where(eq(outboundCalls.id, callId))
      .limit(1);
    const row = rows[0];
    return row ? asOrgId(row.orgId) : null;
  }
}
