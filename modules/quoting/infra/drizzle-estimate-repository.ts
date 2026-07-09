import { and, desc, eq, isNull, isNotNull, inArray, notInArray, sql, type SQL } from "drizzle-orm";
import { estimates, estimateLines } from "@mallet/shared/db/schema";
import type { TenantTx } from "@mallet/shared/db/tx";
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
        discBps: p.discBps,
        taxBps: p.taxBps,
        depBps: p.depBps,
        depPaidCents: p.depPaid,
        validDays: p.validDays,
        sentAt: p.sentAt,
        acceptedAt: p.acceptedAt,
        declinedAt: p.declinedAt,
        declineReason: p.declineReason,
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
          depPaidCents: p.depPaid,
          validDays: p.validDays,
          sentAt: p.sentAt,
          acceptedAt: p.acceptedAt,
          declinedAt: p.declinedAt,
          declineReason: p.declineReason,
          updatedAt: p.updatedAt,
        },
      });

    const keptIds: string[] = [];
    for (const line of p.lines) {
      keptIds.push(line.props.id);
      await this.upsertLine(p.id, p.orgId, line, p.updatedAt);
    }

    // Soft-delete any lines that were removed from the aggregate.
    const removeConds = [eq(estimateLines.estimateId, p.id), isNull(estimateLines.deletedAt)];
    if (keptIds.length > 0) removeConds.push(notInArray(estimateLines.id, keptIds));
    await this.tx.update(estimateLines).set({ deletedAt: p.updatedAt }).where(and(...removeConds));
  }

  private async upsertLine(
    estimateId: string,
    orgId: OrgId,
    line: EstimateLine,
    updatedAt: Date,
  ): Promise<void> {
    const lp = line.props;
    const columns = {
      description: lp.description,
      quantity: lp.quantity,
      rateCents: lp.rate,
      costCents: lp.cost,
      isOptional: lp.isOptional,
      needsPhoto: lp.needsPhoto,
      position: lp.position,
      updatedAt,
      deletedAt: null,
    };
    await this.tx
      .insert(estimateLines)
      .values({ id: lp.id, orgId, estimateId, ...columns })
      .onConflictDoUpdate({ target: estimateLines.id, set: columns });
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

  list(page: CursorPage, filter?: EstimateFilter): Promise<Paginated<Estimate>> {
    const conds: SQL[] = [isNull(estimates.deletedAt)];
    if (filter?.status) conds.push(eq(estimates.status, filter.status));
    return this.loadPage(conds, page);
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
  private async loadPage(baseConds: SQL[], page: CursorPage): Promise<Paginated<Estimate>> {
    const conds = [...baseConds];
    if (page.cursor) {
      const cursor = decodeCursor(page.cursor);
      if (isOk(cursor)) {
        conds.push(
          sql`(${estimates.createdAt}, ${estimates.id}) < (${cursor.value.createdAt}::timestamptz, ${cursor.value.id}::uuid)`,
        );
      }
    }

    const headers = await this.tx
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
    return buildPage(rebuilt, page, (e) => ({ createdAt: e.props.createdAt, id: e.props.id }));
  }
}
