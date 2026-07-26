import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { messages, orgs, leads } from "@mallet/shared/db/schema";
import type { TenantTx } from "@mallet/shared/db/tx";
import { supersedes, type DeliveryStatus } from "../domain/delivery-status";
import { ownerDb } from "@mallet/shared/db/owner-client";
import type { OrgId, LeadId, MessageId } from "@mallet/shared/types";
import { asOrgId, asLeadId } from "@mallet/shared/types";
import type { Message } from "../domain/message";
import type { MessageDirection } from "../domain/message";
import type {
  MessageRepository,
  RecordOutboundInput,
  RecordInboundInput,
  OrgByNumberReader,
  LeadByPhoneReader,
  LeadUnreadMarker,
  ConversationRow,
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


  async applyProviderStatus(input: {
    providerSid: string;
    status: DeliveryStatus;
    errorCode: string | null;
    at: Date;
  }): Promise<boolean> {
    // Read the current status first so an out-of-order callback cannot walk the row backwards.
    // Twilio makes no ordering guarantee, and a late "sent" arriving after "delivered" would
    // otherwise un-deliver a message that plainly arrived.
    const rows = await this.tx
      .select({ id: messages.id, status: messages.status })
      .from(messages)
      .where(and(eq(messages.orgId, this.orgId), eq(messages.providerSid, input.providerSid)))
      .limit(1);
    const row = rows[0];
    if (!row) return false;

    const current = (row.status ?? "queued") as DeliveryStatus;
    if (!supersedes(input.status, current)) return false;

    await this.tx
      .update(messages)
      .set({
        status: input.status,
        errorCode: input.errorCode,
        statusAt: input.at,
        updatedAt: input.at,
      })
      .where(and(eq(messages.orgId, this.orgId), eq(messages.id, row.id)));
    return true;
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

  // One efficient query — no N+1. Uses DISTINCT ON (lead_id) to select the most-recent
  // non-deleted message per lead, then joins to leads for name + unread flag, then sorts
  // the whole result by lastAt DESC. RLS scopes to the current org via withTenant; the
  // explicit m.org_id = current_org_id() filter inside the subquery adds defense-in-depth
  // (same pattern as DrizzleLeadByPhoneReader) so the tenant boundary is visible in the SQL.
  // The optional leadId filter is a stub for a future tech-scoping pass.
  async listConversations(filter?: { leadId?: LeadId }): Promise<ConversationRow[]> {
    // Build the optional WHERE clause for the future lead-scoping pass.
    // When filter.leadId is set we add `AND m.lead_id = <id>` inside the DISTINCT ON sub-select.
    const leadFilter =
      filter?.leadId != null
        ? sql` AND m.lead_id = ${filter.leadId}`
        : sql``;

    // DISTINCT ON (m.lead_id) paired with ORDER BY m.lead_id, m.created_at DESC picks exactly
    // the newest non-deleted message per lead. We wrap it in a sub-select so the outer query
    // can sort by last_at without conflicting with the DISTINCT ON ordering constraint.
    type ConversationRaw = {
      leadId: string;
      leadName: string;
      phone: string | null;
      lastBody: string;
      lastDirection: string;
      lastAt: Date;
      unread: boolean;
    };

    const rows = await this.tx.execute<ConversationRaw>(sql`
      SELECT
        latest.lead_id    AS "leadId",
        l.name            AS "leadName",
        l.phone_e164      AS "phone",
        latest.body       AS "lastBody",
        latest.direction  AS "lastDirection",
        latest.created_at AS "lastAt",
        l.unread          AS "unread"
      FROM (
        SELECT DISTINCT ON (m.lead_id)
          m.lead_id,
          m.body,
          m.direction,
          m.created_at
        FROM messages m
        WHERE m.lead_id IS NOT NULL
          AND m.deleted_at IS NULL
          AND m.org_id = current_org_id()
          ${leadFilter}
        ORDER BY m.lead_id, m.created_at DESC
      ) AS latest
      JOIN leads l ON l.id = latest.lead_id AND l.deleted_at IS NULL
      ORDER BY latest.created_at DESC
    `);

    return rows.map((r) => ({
      leadId: asLeadId(r.leadId),
      leadName: r.leadName,
      phone: r.phone,
      lastBody: r.lastBody,
      lastDirection: r.lastDirection as MessageDirection,
      lastAt: r.lastAt instanceof Date ? r.lastAt : new Date(r.lastAt),
      unread: r.unread,
    }));
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

/**
 * Privileged reader for the delivery-status webhook: resolves the org that owns a message SID.
 *
 * Twilio's callback carries no tenant identity, so the route cannot open a tenant transaction until
 * it knows which org the message belongs to. Returns ONLY the OrgId — nothing about the message
 * itself crosses this boundary. Mirrors DrizzleOrgByCallSidReader in the calls module.
 */
export class DrizzleOrgByMessageSidReader {
  async findOrgIdByProviderSid(providerSid: string): Promise<OrgId | null> {
    const rows = await ownerDb
      .select({ orgId: messages.orgId })
      .from(messages)
      .where(eq(messages.providerSid, providerSid))
      .limit(1);
    const row = rows[0];
    return row ? asOrgId(row.orgId) : null;
  }
}
