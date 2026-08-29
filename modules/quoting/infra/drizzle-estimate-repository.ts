import { and, asc, desc, eq, isNull, isNotNull, inArray, notInArray, sql, type SQL } from "drizzle-orm";
import { estimates, estimateLines, leads } from "@mallet/shared/db/schema";
import type { TenantTx } from "@mallet/shared/db/tx";
import { keysetBefore } from "@mallet/shared/db/keyset";
import { keysetAfterSort, orderFor, decodeSortCursor, encodeSortCursor, sortValueColumn } from "@mallet/shared/db/sort-page";
import { estimateSortSpec, type EstimateSort } from "./estimate-sorts";
import {
  buildPage,
  decodeCursor,
  isOk,
  type OrgId,
  type EstimateId,
  type LeadId,
  type CursorPage,
  type Paginated,
} from "@mallet/shared/types";
import type { Estimate, EstimateLine } from "../domain/estimate";
import type { EstimateRepository, EstimateFilter } from "../domain/estimate-repository";
import type { AiDraftSnapshot } from "../domain/edit-delta";
import { toDomain, type EstimateLineRow } from "./estimate-mapper";

// Real persistence. Constructed with a tenant-scoped tx (withTenant set app.current_org_id), so
// RLS appends org_id = current_org_id() to every statement — this class never filters by org
// itself. orgId is used only to stamp written rows and to scope the number sequence.
export class DrizzleEstimateRepository implements EstimateRepository {
  constructor(
    private readonly tx: TenantTx,
    private readonly orgId: OrgId,
  ) {}

  async nextNumber(): Promise<string> {
    // Ensure the counter row exists, then atomically hand out the current value and advance it.
    // The UPDATE takes a row lock, so concurrent allocations in separate txs serialize (gapless).
    await this.tx.execute(sql`
      insert into number_sequences (org_id, kind) values (${this.orgId}, 'estimate')
      on conflict (org_id, kind) do nothing
    `);
    const rows = (await this.tx.execute(sql`
      update number_sequences set next_val = next_val + 1, updated_at = now()
      where org_id = ${this.orgId} and kind = 'estimate'
      returning next_val - 1 as allocated
    `)) as unknown as { allocated: number }[];
    const allocated = rows[0]?.allocated ?? 1000;
    return `EST-${allocated}`;
  }

  async save(estimate: Estimate): Promise<void> {
    const p = estimate.props;

    await this.tx
      .insert(estimates)
      .values({
        id: p.id,
        orgId: p.orgId,
        num: p.num,
        leadId: p.leadId,
        title: p.title,
        status: p.status,
        // Provenance is birth data: written at insert, deliberately absent from the conflict set
        // below (write-once — an estimate never changes origin, same rule as publicToken).
        origin: p.origin ?? "office",
        discBps: p.discBps,
        taxBps: p.taxBps,
        depBps: p.depBps,
        // Seeded at insert only (always 0 for a new quote) and deliberately absent from the
        // conflict set below — see the note there. Collected money is written by the ledger path.
        depPaidCents: p.depPaid,
        validDays: p.validDays,
        sentAt: p.sentAt,
        followUpOn: p.followUpOn ?? false,
        followUpStage: p.followUpStage ?? 0,
        acceptedAt: p.acceptedAt,
        declinedAt: p.declinedAt,
        declineReason: p.declineReason,
        changeRequestedAt: p.changeRequestedAt,
        changeOrderForJobId: p.changeOrderForJobId,
        jobId: p.jobId,
        changeRequest: p.changeRequest,
        publicToken: p.publicToken,
        recommendedTier: p.recommendedTier,
        acceptedTier: p.acceptedTier,
        tierNames: p.tierNames,
        termsSnapshot: p.termsSnapshot,
        priceDisplay: p.priceDisplay ?? "lines",
        presentationSnapshot: p.presentationSnapshot ? { templateName: p.presentationSnapshot.templateName, pages: [...p.presentationSnapshot.pages] } : null,
        signerName: p.signerName ?? null,
        signatureSvg: p.signatureSvg ?? null,
        signerIp: p.signerIp ?? null,
        signerUserAgent: p.signerUserAgent ?? null,
        signedAt: p.signedAt ?? null,
        signedSnapshot: p.signedSnapshot ?? null,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      })
      .onConflictDoUpdate({
        target: estimates.id,
        set: {
          num: p.num,
          leadId: p.leadId,
          title: p.title,
          status: p.status,
          discBps: p.discBps,
          taxBps: p.taxBps,
          depBps: p.depBps,
          // depPaidCents is NOT in the conflict set — same write-once rule as publicToken and
          // origin, for a sharper reason: it is COLLECTED MONEY, and save() writes a whole
          // in-memory aggregate. Any save() on an accepted estimate from a copy loaded before a
          // deposit settled would silently reset it to that copy's value — usually 0. Live callers
          // that do exactly that: setFollowUp (no status guard), clearChangeRequest, and
          // resignOnSite. The only writer of this column is DrizzleEstimateDepositLedger, which
          // DERIVES it as SUM(amount_cents) over estimate_deposits.
          validDays: p.validDays,
          sentAt: p.sentAt,
          followUpOn: p.followUpOn ?? false,
          followUpStage: p.followUpStage ?? 0,
          acceptedAt: p.acceptedAt,
          declinedAt: p.declinedAt,
          declineReason: p.declineReason,
          changeRequestedAt: p.changeRequestedAt,
          changeOrderForJobId: p.changeOrderForJobId,
          jobId: p.jobId,
          changeRequest: p.changeRequest,
          // publicToken is set once at draft time and never overwritten on subsequent saves.
          recommendedTier: p.recommendedTier,
          acceptedTier: p.acceptedTier,
          tierNames: p.tierNames,
          termsSnapshot: p.termsSnapshot,
          priceDisplay: p.priceDisplay ?? "lines",
          presentationSnapshot: p.presentationSnapshot ? { templateName: p.presentationSnapshot.templateName, pages: [...p.presentationSnapshot.pages] } : null,
          signerName: p.signerName ?? null,
          signatureSvg: p.signatureSvg ?? null,
          signerIp: p.signerIp ?? null,
          signerUserAgent: p.signerUserAgent ?? null,
          signedAt: p.signedAt ?? null,
          signedSnapshot: p.signedSnapshot ?? null,
          updatedAt: p.updatedAt,
        },
      });

    const keptIds = p.lines.map((line) => line.props.id);
    if (p.lines.length > 0) {
      await this.upsertLines(p.id, p.orgId, p.lines, p.updatedAt);
    }

    // Soft-delete any lines that were removed from the aggregate.
    const removeConds = [eq(estimateLines.estimateId, p.id), isNull(estimateLines.deletedAt)];
    if (keptIds.length > 0) removeConds.push(notInArray(estimateLines.id, keptIds));
    await this.tx.update(estimateLines).set({ deletedAt: p.updatedAt }).where(and(...removeConds));
  }

  private async upsertLines(
    estimateId: string,
    orgId: OrgId,
    lines: readonly EstimateLine[],
    updatedAt: Date,
  ): Promise<void> {
    const rows = lines.map((line) => {
      const lp = line.props;
      return {
        id: lp.id,
        orgId,
        estimateId,
        description: lp.description,
        quantity: lp.quantity,
        rateCents: lp.rate,
        costCents: lp.cost,
        isOptional: lp.isOptional,
        needsPhoto: lp.needsPhoto,
        taxable: lp.taxable,
        position: lp.position,
        tier: lp.tier,
        materialId: lp.materialId,
        scope: lp.scope ?? null,
        subItems: lp.subItems ? [...lp.subItems] : null,
        unit: lp.unit ?? null,
        qtyExpr: lp.qtyExpr ?? null,
        roundUp: lp.roundUp ?? false,
        parentLineId: lp.parentLineId ?? null,
        sectionId: lp.sectionId ?? null,
        customerVisible: lp.customerVisible ?? true,
        markupBps: lp.markupBps ?? null,
        updatedAt,
        deletedAt: null as Date | null,
      };
    });
    await this.tx
      .insert(estimateLines)
      .values(rows)
      .onConflictDoUpdate({
        target: estimateLines.id,
        set: {
          description: sql`excluded.description`,
          quantity: sql`excluded.quantity`,
          rateCents: sql`excluded.rate_cents`,
          costCents: sql`excluded.cost_cents`,
          isOptional: sql`excluded.is_optional`,
          needsPhoto: sql`excluded.needs_photo`,
          taxable: sql`excluded.taxable`,
          position: sql`excluded.position`,
          tier: sql`excluded.tier`,
          materialId: sql`excluded.material_id`,
          scope: sql`excluded.scope`,
          subItems: sql`excluded.sub_items`,
          unit: sql`excluded.unit`,
          qtyExpr: sql`excluded.qty_expr`,
          roundUp: sql`excluded.round_up`,
          parentLineId: sql`excluded.parent_line_id`,
          sectionId: sql`excluded.section_id`,
          customerVisible: sql`excluded.customer_visible`,
          markupBps: sql`excluded.markup_bps`,
          updatedAt: sql`excluded.updated_at`,
          deletedAt: sql`excluded.deleted_at`,
        },
      });
  }

  // Write-once snapshot: the WHERE ai_draft IS NULL guard makes overwrites impossible at the
  // data layer (snapshot semantics — the miner must always diff the ORIGINAL AI draft).
  // ai_draft is deliberately absent from save()'s insert values AND conflict set above.
  async setAiDraft(id: EstimateId, snapshot: AiDraftSnapshot): Promise<void> {
    // Fresh mutable structure for the jsonb column (domain type is readonly).
    const value = {
      lines: snapshot.lines.map((l) => ({
        description: l.description,
        quantity: l.quantity,
        rateCents: l.rateCents,
        tier: l.tier ?? null,
      })),
      at: snapshot.at,
    };
    await this.tx
      .update(estimates)
      .set({ aiDraft: value })
      .where(and(eq(estimates.id, id), isNull(estimates.aiDraft)));
  }

  async getAiDraft(id: EstimateId): Promise<AiDraftSnapshot | null> {
    const rows = await this.tx
      .select({ aiDraft: estimates.aiDraft })
      .from(estimates)
      .where(eq(estimates.id, id));
    return rows[0]?.aiDraft ?? null;
  }

  async findById(id: EstimateId): Promise<Estimate | null> {
    const rows = await this.tx
      .select({ estimate: estimates, line: estimateLines })
      .from(estimates)
      .leftJoin(
        estimateLines,
        and(
          eq(estimateLines.orgId, estimates.orgId),
          eq(estimateLines.estimateId, estimates.id),
          isNull(estimateLines.deletedAt),
        ),
      )
      .where(and(eq(estimates.id, id), isNull(estimates.deletedAt)));

    const header = rows[0]?.estimate;
    if (!header) return null;
    const lineRows = rows.map((r) => r.line).filter((l): l is EstimateLineRow => l !== null);
    return toDomain(header, lineRows);
  }

  list(
    page: CursorPage,
    filter?: EstimateFilter,
    sort?: EstimateSort,
    sortDir?: "asc" | "desc",
  ): Promise<Paginated<Estimate>> {
    const conds: SQL[] = [isNull(estimates.deletedAt)];
    if (filter?.status) conds.push(eq(estimates.status, filter.status));
    return this.loadPage(conds, page, sort, sortDir);
  }

  /**
   * Quotes the customer has actually OPENED and not yet answered — the follow-up worklist.
   *
   * "Viewed" is `first_viewed_at`, stamped when the customer loads the public quote link. It is
   * the only honest read signal there is. The home queue used to treat "sent" as "seen" and drafted
   * a text saying "Saw you had a look at the quote" to people who may never have opened it —
   * telling a customer something about themselves that the shop does not know is worse than
   * saying nothing.
   *
   * Ordered by how long it has been sitting: the oldest silence is the one to chase.
   */
  async viewedAwaitingReply(limit: number): Promise<
    { id: string; num: string; leadId: string; customerName: string | null; customerPhone: string | null; title: string | null; totalCents: number; sentAt: Date | null; firstViewedAt: Date | null }[]
  > {
    const rows = await this.tx
      .select({
        id: estimates.id,
        num: estimates.num,
        leadId: estimates.leadId,
        customerName: leads.name,
        customerPhone: leads.phoneE164,
        title: estimates.title,
        sentAt: estimates.sentAt,
        firstViewedAt: estimates.firstViewedAt,
        totalCents: sql<number>`coalesce((
          select sum(round(el.quantity * el.rate_cents))::int
          from estimate_lines el
          where el.estimate_id = ${estimates.id} and el.deleted_at is null
        ), 0)`,
      })
      .from(estimates)
      .leftJoin(leads, and(eq(leads.orgId, estimates.orgId), eq(leads.id, estimates.leadId)))
      .where(
        and(
          isNull(estimates.deletedAt),
          eq(estimates.status, "sent"),
          isNotNull(estimates.firstViewedAt),
        ),
      )
      .orderBy(asc(estimates.sentAt))
      .limit(limit);
    return rows;
  }

  listByLead(leadId: LeadId, page: CursorPage): Promise<Paginated<Estimate>> {
    return this.loadPage([isNull(estimates.deletedAt), eq(estimates.leadId, leadId)], page);
  }

  // Soft-delete (archive) the estimate. Returns the number of affected rows: 0 means not found or
  // already archived. Single UPDATE + RETURNING — no prior findById needed (mirrors lead repo).
  async archive(id: EstimateId, now: Date): Promise<number> {
    const rows = await this.tx
      .update(estimates)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(eq(estimates.id, id), isNull(estimates.deletedAt)))
      .returning();
    return rows.length;
  }

  // Soft-delete non-terminal, non-archived estimates for a given lead. Returns the count of rows
  // affected. Accepted estimates are explicitly excluded so won-revenue quotes survive the cascade.
  // Defense-in-depth: explicit orgId filter in WHERE (mirrors RLS but also aids index use).
  async archiveByLead(leadId: LeadId, now: Date): Promise<number> {
    const rows = await this.tx
      .update(estimates)
      .set({ deletedAt: now, updatedAt: now })
      .where(
        and(
          eq(estimates.orgId, this.orgId),
          eq(estimates.leadId, leadId),
          isNull(estimates.deletedAt),
          inArray(estimates.status, ["draft", "sent", "declined"]),
        ),
      )
      .returning();
    return rows.length;
  }

  // Clear deleted_at on a soft-deleted estimate (restore). Returns the restored aggregate, or null
  // if the estimate was not currently archived (already active or does not exist).
  async restore(id: EstimateId, now: Date): Promise<Estimate | null> {
    const rows = await this.tx
      .update(estimates)
      .set({ deletedAt: null, updatedAt: now })
      .where(and(eq(estimates.id, id), isNotNull(estimates.deletedAt)))
      .returning();
    const row = rows[0];
    if (!row) return null;
    // Load lines separately (the header row from .returning() never carries line data).
    const lineRows = await this.tx
      .select()
      .from(estimateLines)
      .where(and(eq(estimateLines.estimateId, id), isNull(estimateLines.deletedAt)));
    return toDomain(row, lineRows);
  }

  // Keyset-paginate estimate headers, then batch-load their lines in ONE query (no N+1) and
  // rebuild the aggregates so derived totals are available to the caller.
  /**
   * One page of estimates with their lines.
   *
   * Two paths on purpose. Without a sort it keeps the original createdAt-descending keyset exactly
   * as it was, so listByLead and every existing caller are untouched. With a named sort it routes
   * through the shared sort/cursor machinery, where the cursor carries the value of the SAME
   * expression ORDER BY leads with — the property that stops a page repeating or skipping a row.
   */
  private async loadPage(
    baseConds: SQL[],
    page: CursorPage,
    sort?: EstimateSort,
    sortDir?: "asc" | "desc",
  ): Promise<Paginated<Estimate>> {
    const conds = [...baseConds];
    const spec = sort ? estimateSortSpec(sort, sortDir) : null;

    if (page.cursor) {
      if (spec) {
        const cursor = decodeSortCursor(page.cursor);
        if (cursor) {
          const after = keysetAfterSort(spec, estimates.id, cursor);
          if (after) conds.push(after);
        }
      } else {
        const cursor = decodeCursor(page.cursor);
        if (isOk(cursor)) {
          conds.push(keysetBefore(estimates.createdAt, estimates.id, cursor.value));
        }
      }
    }

    // The sorted path selects the sort column a second time, cast to text, and builds the cursor
    // from that — a timestamptz round-tripped through a JS Date loses microseconds, and a cursor
    // built from the truncated value matches its own row again. See sortValueColumn.
    const selected = spec
      ? await this.tx
          .select({ row: estimates, sortValue: sortValueColumn(spec) })
          .from(estimates)
          .where(and(...conds))
          .orderBy(...orderFor(spec, estimates.id))
          .limit(page.limit + 1)
      : null;

    const headers = selected
      ? selected.map((r) => r.row)
      : await this.tx
          .select()
          .from(estimates)
          .where(and(...conds))
          .orderBy(desc(estimates.createdAt), desc(estimates.id))
          .limit(page.limit + 1);

    const ids = headers.map((h) => h.id);
    const lineRows = ids.length
      ? await this.tx
          .select()
          .from(estimateLines)
          .where(and(inArray(estimateLines.estimateId, ids), isNull(estimateLines.deletedAt)))
      : [];

    const linesByEstimate = new Map<string, EstimateLineRow[]>();
    for (const line of lineRows) {
      const bucket = linesByEstimate.get(line.estimateId) ?? [];
      bucket.push(line);
      linesByEstimate.set(line.estimateId, bucket);
    }

    const rebuilt = headers.map((h) => toDomain(h, linesByEstimate.get(h.id) ?? []));

    if (!selected) {
      return buildPage(rebuilt, page, (e) => ({ createdAt: e.props.createdAt, id: e.props.id }));
    }

    const hasMore = selected.length > page.limit;
    const kept = hasMore ? selected.slice(0, page.limit) : selected;
    const last = kept[kept.length - 1];
    return {
      items: rebuilt.slice(0, kept.length),
      nextCursor: hasMore && last ? encodeSortCursor({ value: last.sortValue, id: last.row.id }) : null,
    };
  }
}
