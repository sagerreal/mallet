import { and, desc, eq, ilike, inArray, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import { leads } from "@mallet/shared/db/schema";
import type { TenantTx } from "@mallet/shared/db/tx";
import { keysetBefore } from "@mallet/shared/db/keyset";
import { keysetAfterSort, orderFor, decodeSortCursor, encodeSortCursor, sortValueOf, sortValueColumn } from "@mallet/shared/db/sort-page";
import { leadSortSpec, type LeadSort } from "./lead-sorts";
import { leadViewCondition, leadScopeCondition, leadGroupCondition, type LeadView, type LeadGroup } from "./lead-views";
import {
  buildPage,
  decodeCursor,
  isOk,
  type OrgId,
  type LeadId,
  type CursorPage,
  type Paginated,
  type Phone,
} from "@mallet/shared/types";
import type { Lead } from "../domain/lead";
import type {
  LeadRepository,
  EnsureCustomerInput,
  EnsureCustomerResult,
  LeadFilter,
} from "../domain/lead-repository";
import { toDomain } from "./lead-mapper";
import { normalizeTags } from "../domain/customer-tags";

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
        customFields: null, // created leads start with no custom fields
        source: input.source,
        // Normalised here as well as in the domain: this insert bypasses Lead.create (it has to,
        // so ON CONFLICT can do the dedupe), making it the one write that would otherwise store a
        // raw list. Absent from every system caller → the empty set.
        tags: [...normalizeTags(input.tags ?? [])],
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


  async findByPhone(phone: Phone): Promise<Lead | null> {
    const rows = await this.tx
      .select()
      .from(leads)
      // Org-scoped explicitly as well as by RLS, and LIVE rows only — the unique index this
      // mirrors is partial on `deleted_at is null`, so an archived customer must not block a
      // number being reused.
      .where(
        and(
          eq(leads.orgId, this.orgId),
          eq(leads.phoneE164, phone),
          isNull(leads.deletedAt),
        ),
      )
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

  async findByNames(names: readonly string[]): Promise<Lead[]> {
    if (names.length === 0) return [];
    // Compare on lower(name) so "Gary Pratt" and "gary pratt" are one customer. Deduped first so a
    // chunk repeating the same name doesn't inflate the IN list.
    const wanted = [...new Set(names.map((n) => n.trim().toLowerCase()).filter(Boolean))];
    if (wanted.length === 0) return [];
    const rows = await this.tx
      .select()
      .from(leads)
      .where(
        and(
          eq(leads.orgId, this.orgId),
          inArray(sql`lower(${leads.name})`, wanted),
          isNull(leads.deletedAt),
        ),
      );
    return rows.map(toDomain);
  }

  /** Predicates shared by list() and count(), so the two can never answer different questions. */
  private listConds(filter?: LeadFilter): SQL[] {
    // Archiving is a soft delete, so the archived SET is the deleted rows — not a separate column.
    // This was an unconditional isNull, which is why the Archived tab could never show an archived
    // customer: it returned the live list and the screen just added a Restore column to it.
    const conds: SQL[] = [filter?.archived ? isNotNull(leads.deletedAt) : isNull(leads.deletedAt)];
    if (filter?.stage) conds.push(eq(leads.stage, filter.stage));
    // "none" = explicitly unstaged (IS NULL) — the board's leading column. Absent = no filter.
    if (filter?.pipelineStage === "none") conds.push(isNull(leads.pipelineStageId));
    else if (filter?.pipelineStage) conds.push(eq(leads.pipelineStageId, filter.pipelineStage));
    if (filter?.unreadOnly) conds.push(eq(leads.unread, true));
    if (filter?.source) conds.push(eq(leads.source, filter.source));
    if (filter?.view) conds.push(leadViewCondition(filter.view, this.tx));
    if (filter?.scope) conds.push(leadScopeCondition(filter.scope, this.tx));
    if (filter?.group) conds.push(leadGroupCondition(filter.group, this.tx));
    if (filter?.search) {
      // Escape LIKE wildcards first: unescaped, a customer typing "%" matches the entire book and
      // the search silently stops filtering.
      const term = filter.search.replace(/[\\%_]/g, (m) => `\\${m}`);
      const like = `%${term}%`;
      const cond = or(
        ilike(leads.name, like),
        ilike(leads.phoneE164, like),
        ilike(leads.email, like),
        ilike(leads.address, like),
        // Tags are searchable so "google" finds the customers filed under it. Joined on a NEWLINE
        // rather than a space on purpose: a separator the search box cannot produce means a query
        // can never match across two adjacent tags (tags {"Yard","Sign"} must not answer "yard
        // sign" — only the single tag "Yard sign" should).
        sql`array_to_string(${leads.tags}, E'\n') ilike ${like}`,
      );
      if (cond) conds.push(cond);
    }
    return conds;
  }

  /** Every Pipeline column's count in ONE round trip — the board shows all four at once. */
  async viewCounts(): Promise<Record<LeadView, number>> {
    const one = (v: LeadView) => sql<number>`count(*) filter (where ${leadViewCondition(v, this.tx)})::int`;
    const rows = await this.tx
      .select({ intake: one("intake"), quoting: one("quoting"), out: one("out"), won: one("won") })
      .from(leads)
      .where(and(eq(leads.orgId, this.orgId), isNull(leads.deletedAt)));
    const r = rows[0];
    return { intake: r?.intake ?? 0, quoting: r?.quoting ?? 0, out: r?.out ?? 0, won: r?.won ?? 0 };
  }

  /** Live-lead counts per shop-defined stage, one GROUP BY. Key "none" = unstaged. */
  async pipelineStageCounts(): Promise<Record<string, number>> {
    const rows = await this.tx
      .select({ stageId: leads.pipelineStageId, n: sql<number>`count(*)::int` })
      .from(leads)
      .where(and(eq(leads.orgId, this.orgId), isNull(leads.deletedAt)))
      .groupBy(leads.pipelineStageId);
    const out: Record<string, number> = {};
    for (const r of rows) out[r.stageId ?? "none"] = r.n;
    return out;
  }

  /**
   * Every work group's count, in ONE read.
   *
   * All seven together rather than a query each: the chips are only trustworthy if their numbers
   * come from the same instant, and seven round trips against a live book can disagree with each
   * other while somebody is working. `filter (where ...)` is what makes it one scan.
   */
  /**
   * Every group's count in one round trip — the Customers chip row's numbers.
   *
   * Takes the LIST's filter and builds from `listConds`, minus the group itself. It used to carry
   * its own hard-coded `where org AND not deleted`, which meant two things went wrong: the counts
   * were a SECOND definition of the base set, and they could not narrow by search. Typing a
   * no-match search left the chips reading "Invoice required (19), Owes money (14), Job booked
   * (35)" over a list showing "0 of 0" — the chips claiming 90 customers that were not there.
   *
   * `group` is stripped deliberately: the groups ARE the breakdown, so a base that already selected
   * one would return that group's count in its own column and zero everywhere else.
   */
  async groupCounts(base?: LeadFilter): Promise<Record<LeadGroup, number>> {
    const baseConds = this.listConds({ ...base, group: undefined });
    const one = (g: LeadGroup) => sql<number>`count(*) filter (where ${leadGroupCondition(g, this.tx)})::int`;
    const rows = await this.tx
      .select({
        invoiceRequired: one("invoiceRequired"),
        owesMoney: one("owesMoney"),
        quoteOut: one("quoteOut"),
        jobBooked: one("jobBooked"),
        neverBooked: one("neverBooked"),
        lost: one("lost"),
        workCompleted: one("workCompleted"),
      })
      .from(leads)
      .where(and(eq(leads.orgId, this.orgId), ...baseConds));
    const r = rows[0];
    return {
      invoiceRequired: r?.invoiceRequired ?? 0,
      owesMoney: r?.owesMoney ?? 0,
      quoteOut: r?.quoteOut ?? 0,
      jobBooked: r?.jobBooked ?? 0,
      neverBooked: r?.neverBooked ?? 0,
      lost: r?.lost ?? 0,
      workCompleted: r?.workCompleted ?? 0,
    };
  }

  async facets(): Promise<{ stages: Record<string, number>; sources: { source: string; n: number }[] }> {
    // Two grouped reads rather than one page scanned in the browser. The screen derived both from
    // the loaded collection, so on a book bigger than one page the dropdown silently offered only
    // the stages and sources present in the first 500 rows.
    const [stageRows, sourceRows] = await Promise.all([
      this.tx
        .select({ stage: leads.stage, n: sql<number>`count(*)::int` })
        .from(leads)
        .where(and(eq(leads.orgId, this.orgId), isNull(leads.deletedAt)))
        .groupBy(leads.stage),
      this.tx
        .select({ source: leads.source, n: sql<number>`count(*)::int` })
        .from(leads)
        .where(and(eq(leads.orgId, this.orgId), isNull(leads.deletedAt), isNotNull(leads.source)))
        .groupBy(leads.source)
        // Bounded: source is free text, so a bad import could otherwise put thousands of options
        // in a dropdown. The long tail is not worth offering.
        .orderBy(desc(sql`count(*)`))
        .limit(25),
    ]);
    return {
      stages: Object.fromEntries(stageRows.map((r) => [r.stage, r.n])),
      sources: sourceRows.filter((r) => r.source).map((r) => ({ source: r.source as string, n: r.n })),
    };
  }

  async count(filter?: LeadFilter): Promise<number> {
    const rows = await this.tx
      .select({ n: sql<number>`count(*)::int` })
      .from(leads)
      .where(and(...this.listConds(filter)));
    return rows[0]?.n ?? 0;
  }

  async list(
    page: CursorPage,
    filter?: LeadFilter,
    sort?: LeadSort,
    sortDir?: "asc" | "desc",
  ): Promise<Paginated<Lead>> {
    const conds = this.listConds(filter);
    const spec = sort ? leadSortSpec(sort, sortDir) : null;

    if (page.cursor) {
      if (spec) {
        const c = decodeSortCursor(page.cursor);
        // Malformed cursor → page one. Wrong, but harmless; throwing would break a list on a
        // stale bookmark.
        if (c) {
          const after = keysetAfterSort(spec, leads.id, c);
          if (after) conds.push(after);
        }
      } else {
        const cursor = decodeCursor(page.cursor);
        // Keyset: rows strictly after the cursor in (created_at desc, id desc) order.
        if (isOk(cursor)) conds.push(keysetBefore(leads.createdAt, leads.id, cursor.value));
      }
    }

    // Fetch one extra row so we can tell whether a next page exists.
    if (!spec) {
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

    // Sorted path selects the sort column a SECOND time as ::text and builds the cursor from that.
    // A timestamptz round-tripped through a JS Date loses microseconds, and a cursor built from
    // the truncated value still matches its own row — repeating it on the next page. See
    // sortValueColumn.
    const rows = await this.tx
      .select({ row: leads, sortValue: sortValueColumn(spec) })
      .from(leads)
      .where(and(...conds))
      .orderBy(...orderFor(spec, leads.id))
      .limit(page.limit + 1);

    const hasMore = rows.length > page.limit;
    const kept = hasMore ? rows.slice(0, page.limit) : rows;
    const last = kept[kept.length - 1];
    return {
      items: kept.map((r) => toDomain(r.row)),
      nextCursor: hasMore && last ? encodeSortCursor({ value: last.sortValue, id: last.row.id }) : null,
    };
  }

  async save(lead: Lead): Promise<void> {
    const p = lead.props;
    await this.tx
      .update(leads)
      .set({
        name: p.name,
        phoneE164: p.phone,
        email: p.email,
        customFields: p.customFields as { label: string; value: string }[] | null,
        source: p.source,
        tags: [...p.tags],
        stage: p.stage,
        valueCents: p.value,
        unread: p.unread,
        wonAt: p.wonAt,
        companyId: p.companyId,
        role: p.role,
        notes: p.notes,
        lossReason: p.lossReason,
        address: p.address,
        pipelineStageId: p.pipelineStageId,
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
