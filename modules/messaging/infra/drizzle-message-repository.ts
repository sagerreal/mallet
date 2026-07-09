import { and, asc, eq, isNull } from "drizzle-orm";
import { messages, orgs, leads } from "@mallet/shared/db/schema";
import type { TenantTx } from "@mallet/shared/db/tx";
import { ownerDb } from "@mallet/shared/db/owner-client";
import type { OrgId, LeadId, MessageId } from "@mallet/shared/types";
import { asOrgId } from "@mallet/shared/types";
import type { Message } from "../domain/message";
import type {
  MessageRepository,
  RecordOutboundInput,
  RecordInboundInput,
  OrgByNumberReader,
  LeadByPhoneReader,
  LeadUnreadMarker,
} from "../domain/message-repository";
import { toDomain } from "./message-mapper";
import { DrizzleLeadRepository } from "@/modules/customers/infra/drizzle-lead-repository";

// Real persistence. Constructed with a tenant-scoped transaction (withTenant already set
// app.current_org_id), so RLS appends `org_id = current_org_id()` to every statement.
// orgId is supplied only to stamp inserted rows.
export class DrizzleMessageRepository implements MessageRepository {
  constructor(
    private readonly tx: TenantTx,
    private readonly orgId: OrgId,
  ) {}

  async recordOutbound(input: RecordOutboundInput): Promise<Message> {
    const rows = await this.tx
      .insert(messages)
      .values({
        id: input.id,
        orgId: this.orgId,
        leadId: input.leadId,
        direction: "outbound",
        channel: "sms",
        body: input.body,
        fromNumber: input.fromNumber,
        toNumber: input.toNumber,
        providerSid: input.providerSid,
        status: input.status,
      })
      .returning();
    const row = rows[0];
    if (!row) throw new Error("message insert returned no row");
    return toDomain(row);
  }

  async recordInbound(input: RecordInboundInput): Promise<Message> {
    const rows = await this.tx
      .insert(messages)
      .values({
        id: input.id,
        orgId: this.orgId,
        leadId: input.leadId,
        direction: "inbound",
        channel: "sms",
        body: input.body,
        fromNumber: input.fromNumber,
        toNumber: input.toNumber,
        providerSid: input.providerSid,
        status: "received",
      })
      .returning();
    const row = rows[0];
    if (!row) throw new Error("message insert returned no row");
    return toDomain(row);
  }

  async listByLead(leadId: LeadId, page: { limit: number; offset: number }): Promise<Message[]> {
    const rows = await this.tx
      .select()
      .from(messages)
      .where(and(eq(messages.leadId, leadId), isNull(messages.deletedAt)))
      .orderBy(asc(messages.createdAt))
      .limit(page.limit)
      .offset(page.offset);
    return rows.map(toDomain);
  }

  async findById(id: MessageId): Promise<Message | null> {
    const rows = await this.tx
      .select()
      .from(messages)
      .where(and(eq(messages.id, id), isNull(messages.deletedAt)))
      .limit(1);
    const row = rows[0];
    return row ? toDomain(row) : null;
  }
}

// Privileged reader — NOT org-scoped. The inbound Twilio webhook arrives with no principal;
// it needs to look up which org owns a given To-number before it can open a tenant session.
// Uses ownerDb (the `postgres` BYPASSRLS role) because no RLS context exists yet — the normal
// mallet_app client would see current_org_id()=NULL and return zero rows, silently dropping
// every inbound SMS. ownerDb is the same privileged path used by the outbox relay (ADR 0003).
// It returns only the OrgId, never row data, minimising surface area of the privileged path.
export class DrizzleOrgByNumberReader implements OrgByNumberReader {
  async findOrgIdByTwilioNumber(twilioNumber: string): Promise<OrgId | null> {
    const rows = await ownerDb
      .select({ id: orgs.id })
      .from(orgs)
      .where(eq(orgs.twilioNumber, twilioNumber))
      .limit(1);
    const row = rows[0];
    return row ? asOrgId(row.id) : null;
  }
}

// Org-scoped reader — runs inside a withTenant tx. Looks up an active lead by their E.164 phone
// within the current tenant. RLS enforces org scoping at the session level; the explicit eq(orgId)
// adds defense-in-depth at the query level so the tenant boundary is visible in the SQL itself.
export class DrizzleLeadByPhoneReader implements LeadByPhoneReader {
  constructor(
    private readonly tx: TenantTx,
    private readonly orgId: OrgId,
  ) {}

  async findLeadByPhone(phoneE164: string): Promise<{ leadId: LeadId } | null> {
    const rows = await this.tx
      .select({ id: leads.id })
      .from(leads)
      .where(and(eq(leads.orgId, this.orgId), eq(leads.phoneE164, phoneE164), isNull(leads.deletedAt)))
      .limit(1);
    const row = rows[0];
    return row ? { leadId: row.id as LeadId } : null;
  }
}

// Org-scoped writer — runs inside a withTenant tx. Loads the lead through the domain's LeadRepository,
// calls markUnread(), and persists via save() so invariants are enforced by the domain layer.
// Idempotent: if the lead is already unread or not found, no row is written (returns false).
export class DrizzleLeadUnreadMarker implements LeadUnreadMarker {
  constructor(
    private readonly tx: TenantTx,
    private readonly orgId: OrgId,
  ) {}

  async markLeadUnread(leadId: LeadId, now: Date): Promise<boolean> {
    const repo = new DrizzleLeadRepository(this.tx, this.orgId);
    const lead = await repo.findById(leadId);
    if (!lead) return false;
    const updated = lead.markUnread(now);
    // markUnread is a no-op when already unread — compare references to detect that case.
    if (updated === lead) return false;
    await repo.save(updated);
    return true;
  }
}
