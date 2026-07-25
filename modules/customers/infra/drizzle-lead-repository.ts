import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { leads } from "@mallet/shared/db/schema";
import type { TenantTx } from "@mallet/shared/db/tx";
import { keysetBefore } from "@mallet/shared/db/keyset";
import {
  buildPage,
  decodeCursor,
  isOk,
  type OrgId,
  type LeadId,
  type CursorPage,
  type Paginated,
} from "@mallet/shared/types";
import type { Lead } from "../domain/lead";
import type {
  LeadRepository,
  EnsureCustomerInput,
  EnsureCustomerResult,
  LeadFilter,
} from "../domain/lead-repository";
import { toDomain } from "./lead-mapper";

// Real persistence. Constructed with a tenant-scoped transaction (withTenant already set
// app.current_org_id), so RLS appends `org_id = current_org_id()` to every statement — this
// class never adds an org_id filter itself. orgId is supplied only to stamp inserted rows.
export class DrizzleLeadRepository implements LeadRepository {
  constructor(
    private readonly tx: TenantTx,
    private readonly orgId: OrgId,
  ) {}

  async ensureCustomer(input: EnsureCustomerInput): Promise<EnsureCustomerResult> {
    // Insert; if an active customer with this phone already exists, the partial unique index
    // fires and ON CONFLICT DO NOTHING returns nothing. A null phone can never conflict.
    const inserted = await this.tx
      .insert(leads)
      .values({
        orgId: this.orgId,
        name: input.name,
        phoneE164: input.phone,
        email: input.email,
        source: input.source,
        companyId: input.companyId,
        role: input.role,
        // Belt-and-suspenders: new leads are born read. unread is only raised by
        // inbound SMS (Lead.markUnread), never on create.
        unread: false,
        notes: input.notes,
        address: input.address,
      })
      .onConflictDoNothing({
        target: [leads.orgId, leads.phoneE164],
        where: sql`deleted_at is null and phone_e164 is not null`,
      })
      .returning();

    const insertedRow = inserted[0];
    if (insertedRow) return { lead: toDomain(insertedRow), created: true };

    // Conflict: phone is necessarily non-null here. Return the existing active customer.
    if (input.phone === null) {
      throw new Error("ensureCustomer: insert returned no row for a null-phone lead");
    }
    const existing = await this.tx
      .select()
      .from(leads)
      .where(and(eq(leads.phoneE164, input.phone), isNull(leads.deletedAt)))
      .limit(1);
    const existingRow = existing[0];
    if (!existingRow) {
      throw new Error("ensureCustomer: conflict reported but no active row found");
    }
    return { lead: toDomain(existingRow), created: false };
  }

  async findById(id: LeadId): Promise<Lead | null> {
    const rows = await this.tx
      .select()
      .from(leads)
      .where(and(eq(leads.id, id), isNull(leads.deletedAt)))
      .limit(1);
    const row = rows[0];
    return row ? toDomain(row) : null;
  }

  async findByIds(ids: readonly LeadId[]): Promise<Lead[]> {
    if (ids.length === 0) return [];
    const rows = await this.tx
      .select()
      .from(leads)
      .where(and(inArray(leads.id, [...ids]), isNull(leads.deletedAt)));
    return rows.map(toDomain);
  }

  async list(page: CursorPage, filter?: LeadFilter): Promise<Paginated<Lead>> {
    const conds = [isNull(leads.deletedAt)];
    if (filter?.stage) conds.push(eq(leads.stage, filter.stage));
    if (filter?.unreadOnly) conds.push(eq(leads.unread, true));
    if (page.cursor) {
      const cursor = decodeCursor(page.cursor);
      if (isOk(cursor)) {
        // Keyset: rows strictly after the cursor in (created_at desc, id desc) order.
        conds.push(keysetBefore(leads.createdAt, leads.id, cursor.value));
      }
    }
    // Fetch one extra row so buildPage can tell whether a next page exists.
    const rows = await this.tx
      .select()
      .from(leads)
      .where(and(...conds))
      .orderBy(desc(leads.createdAt), desc(leads.id))
      .limit(page.limit + 1);

    return buildPage(rows.map(toDomain), page, (lead) => ({
      createdAt: lead.props.createdAt,
      id: lead.props.id,
    }));
  }

  async save(lead: Lead): Promise<void> {
    const p = lead.props;
    await this.tx
      .update(leads)
      .set({
        name: p.name,
        phoneE164: p.phone,
        email: p.email,
        source: p.source,
        stage: p.stage,
        valueCents: p.value,
        unread: p.unread,
        wonAt: p.wonAt,
        companyId: p.companyId,
        role: p.role,
        notes: p.notes,
        address: p.address,
        updatedAt: p.updatedAt,
      })
      // Guard: org-scoped + non-deleted (defense in depth, mirrors company + task repos).
      .where(and(eq(leads.id, p.id), eq(leads.orgId, this.orgId), isNull(leads.deletedAt)));
  }

  async archive(id: LeadId, now: Date): Promise<number> {
    const rows = await this.tx
      .update(leads)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(eq(leads.id, id), isNull(leads.deletedAt)))
      .returning();
    return rows.length;
  }

  async restore(id: LeadId, now: Date): Promise<Lead | null> {
    const rows = await this.tx
      .update(leads)
      .set({ deletedAt: null, updatedAt: now })
      // Only restore rows that are currently soft-deleted; already-active rows produce no match.
      .where(and(eq(leads.id, id), isNotNull(leads.deletedAt)))
      .returning();
    const row = rows[0];
    return row ? toDomain(row) : null;
  }
}
