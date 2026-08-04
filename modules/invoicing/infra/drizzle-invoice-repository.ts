import { and, desc, eq, exists, gt, ilike, isNull, lt, ne, inArray, notInArray, or, sql, type SQL } from "drizzle-orm";
import { invoices, invoiceLines, payments, leads } from "@mallet/shared/db/schema";
import type { TenantTx } from "@mallet/shared/db/tx";
import { keysetBefore } from "@mallet/shared/db/keyset";
import { keysetAfterSort, orderFor, decodeSortCursor, encodeSortCursor, sortValueOf, sortValueColumn } from "@mallet/shared/db/sort-page";
import { invoiceSortSpec, type InvoiceSort } from "./invoice-sorts";
import { invoiceViewCondition } from "./invoice-views";
import {
  buildPage,
  decodeCursor,
  isOk,
  type OrgId,
  type InvoiceId,
  type JobId,
  type LeadId,
  type CursorPage,
  type Paginated,
} from "@mallet/shared/types";
import type { Invoice } from "../domain/invoice";
import type { InvoiceLine } from "../domain/invoice-line";
import type { Payment } from "../domain/payment";
import type { InvoiceRepository, InvoiceFilter, ApplyResult } from "../domain/invoice-repository";
import { toDomain } from "./invoice-mapper";

const OPEN_STATUSES = ["sent", "partial"] as const;

// Real persistence. Constructed with a tenant-scoped tx; RLS scopes every statement, so this class
// never filters by org itself. orgId only stamps written rows and scopes the number sequence.
export class DrizzleInvoiceRepository implements InvoiceRepository {
  constructor(
    private readonly tx: TenantTx,
    private readonly orgId: OrgId,
  ) {}

  async nextNumber(): Promise<string> {
    await this.tx.execute(sql`
      insert into number_sequences (org_id, kind) values (${this.orgId}, 'invoice')
      on conflict (org_id, kind) do nothing
    `);
    const rows = (await this.tx.execute(sql`
      update number_sequences set next_val = next_val + 1, updated_at = now()
      where org_id = ${this.orgId} and kind = 'invoice'
      returning next_val - 1 as allocated
    `)) as unknown as { allocated: number }[];
    return `INV-${rows[0]?.allocated ?? 1000}`;
  }

  private headerColumns(invoice: Invoice) {
    const p = invoice.props;
    return {
      num: p.num,
      sourceJobId: p.sourceJobId,
      leadId: p.leadId,
      title: p.title,
      status: p.status,
      totalCents: p.total,
      taxBps: p.taxBps,
      taxCents: p.tax,
      depositPaidCents: p.depositPaid,
      amountPaidCents: p.amountPaid,
      termsDays: p.termsDays,
      sentAt: p.sentAt,
      dueAt: p.dueAt,
      poNumber: p.poNumber,
      followUpOn: p.followUpOn ?? false,
      followUpStage: p.followUpStage ?? 0,
      updatedAt: p.updatedAt,
    };
  }

  async save(invoice: Invoice): Promise<void> {
    const p = invoice.props;
    const columns = this.headerColumns(invoice);
    // amount_paid_cents is owned exclusively by applyPayment's atomic increment — never written
    // back here from an in-memory (possibly stale) value, or a concurrent payment would be lost.
    const { amountPaidCents: _ownedByApplyPayment, ...updatable } = columns;
    await this.tx
      .insert(invoices)
      .values({ id: p.id, orgId: p.orgId, createdAt: p.createdAt, publicToken: p.publicToken, ...columns })
      .onConflictDoUpdate({
        target: invoices.id,
        set: {
          ...updatable,
          // WRITE-ONCE, enforced in the database: an existing token survives every later save (a
          // rotated token would strand the pay link already texted to the customer); only a NULL
          // one adopts the mint. Send-invoice re-reads after save so a racing double-send returns
          // the token the row actually kept.
          publicToken: sql`coalesce(${invoices.publicToken}, excluded.public_token)`,
        },
      });
    await this.diffLines(invoice);
  }

  async findByPublicToken(token: string): Promise<Invoice | null> {
    const rows = await this.tx
      .select()
      .from(invoices)
      .where(and(eq(invoices.publicToken, token), isNull(invoices.deletedAt)))
      .limit(1);
    const header = rows[0];
    return header ? this.hydrate(header) : null;
  }

  // Atomically apply a payment to the denormalized header: increment amount_paid_cents and
  // recompute status IN ONE UPDATE, so concurrent distinct-key payments serialize on the row lock
  // and never lose an update under READ COMMITTED. The WHERE re-asserts the payable status
  // (sent|partial) under that lock — NOT a stale in-memory check — so a void/pay committing
  // concurrently (e.g. a manual void racing a settling card webhook) can't be clobbered back to
  // 'paid'. `applied` reflects whether a payable row matched; the row still stands for a not-applied
  // payment (real money) so the caller can surface it for reconciliation rather than double-pay.
  async applyPayment(invoiceId: InvoiceId, amountCents: number): Promise<ApplyResult> {
    const rows = (await this.tx.execute(sql`
      update invoices
      set amount_paid_cents = amount_paid_cents + ${amountCents},
          status = case
            when total_cents - deposit_paid_cents - (amount_paid_cents + ${amountCents}) <= 0
            then 'paid' else 'partial' end,
          updated_at = now()
      where id = ${invoiceId} and deleted_at is null and status in ('sent', 'partial')
      returning id
    `)) as unknown as { id: string }[];
    return { applied: rows.length > 0, invoice: await this.findById(invoiceId) };
  }

  async insertForJob(invoice: Invoice): Promise<boolean> {
    const p = invoice.props;
    const inserted = await this.tx
      .insert(invoices)
      .values({ id: p.id, orgId: p.orgId, createdAt: p.createdAt, ...this.headerColumns(invoice) })
      .onConflictDoNothing({
        target: [invoices.orgId, invoices.sourceJobId],
        where: sql`source_job_id is not null and deleted_at is null`,
      })
      .returning({ id: invoices.id });
    if (inserted.length === 0) return false;
    await this.diffLines(invoice);
    return true;
  }

  async insertPayment(orgId: OrgId, invoiceId: InvoiceId, payment: Payment): Promise<boolean> {
    const pp = payment.props;
    const inserted = await this.tx
      .insert(payments)
      .values({
        id: pp.id,
        orgId,
        invoiceId,
        amountCents: pp.amount,
        method: pp.method,
        idempotencyKey: pp.idempotencyKey,
        externalId: pp.externalId,
        receivedAt: pp.receivedAt,
      })
      .onConflictDoNothing({ target: [payments.orgId, payments.idempotencyKey] })
      .returning({ id: payments.id });
    return inserted.length > 0;
  }

  async findById(id: InvoiceId): Promise<Invoice | null> {
    const rows = await this.tx
      .select()
      .from(invoices)
      .where(and(eq(invoices.id, id), isNull(invoices.deletedAt)))
      .limit(1);
    const header = rows[0];
    return header ? this.hydrate(header) : null;
  }

  async findBySourceJob(jobId: JobId): Promise<Invoice | null> {
    const rows = await this.tx
      .select()
      .from(invoices)
      .where(and(eq(invoices.sourceJobId, jobId), isNull(invoices.deletedAt)))
      .limit(1);
    const header = rows[0];
    return header ? this.hydrate(header) : null;
  }

  /** Predicates shared by list() and count(), so the two can never answer different questions. */
  private listConds(filter?: InvoiceFilter): SQL[] {
    const conds: SQL[] = [isNull(invoices.deletedAt)];
    if (filter?.status) conds.push(eq(invoices.status, filter.status));
    // The LEDGER's status, which is not the same thing as the status column: "overdue" and "paid"
    // are facts about the balance and the due date. See invoice-views.ts.
    if (filter?.view) conds.push(invoiceViewCondition(filter.view));
    if (filter?.unpaidOnly) conds.push(inArray(invoices.status, [...OPEN_STATUSES]));
    if (filter?.search) {
      // Escape LIKE wildcards: unescaped, "%" matches every invoice and the search silently
      // stops filtering.
      const term = filter.search.replace(/[\\%_]/g, (m) => `\\${m}`);
      const like = `%${term}%`;
      // Customer name via EXISTS, not a join — a join multiplies rows and breaks the keyset.
      const cond = or(
        ilike(invoices.num, like),
        ilike(invoices.title, like),
        exists(
          this.tx
            .select({ one: sql`1` })
            .from(leads)
            .where(and(eq(leads.orgId, invoices.orgId), eq(leads.id, invoices.leadId), ilike(leads.name, like))),
        ),
      );
      if (cond) conds.push(cond);
    }
    return conds;
  }

  /**
   * The ledger's headline money, summed in the DATABASE.
   *
   * The Dashboard added these up from the invoices the browser had loaded — one page — so on a
   * shop with 847 invoices the "Owed" tile stated the balance of whichever 500 were cached, as
   * fact, on the first screen of the app. A number that is confidently wrong is worse than one
   * that is missing.
   *
   * `openCents` is what is still owed on anything sent; `overdueCents` is the part of that past
   * its due date. Both use the same balance expression as the ledger's status bands, so the tile
   * and the list it links to cannot disagree.
   */
  async totals(): Promise<{ openCents: number; overdueCents: number; openCount: number }> {
    const owed = sql<number>`greatest(0, ${invoices.totalCents} - ${invoices.depositPaidCents} - ${invoices.amountPaidCents})`;
    const isOpen = and(isNull(invoices.deletedAt), ne(invoices.status, "draft"), gt(owed, 0));
    const rows = await this.tx
      .select({
        openCents: sql<number>`coalesce(sum(${owed}) filter (where ${isOpen}), 0)::int`,
        overdueCents: sql<number>`coalesce(sum(${owed}) filter (where ${isOpen} and ${invoices.dueAt} is not null and ${invoices.dueAt} < now()), 0)::int`,
        openCount: sql<number>`count(*) filter (where ${isOpen})::int`,
      })
      .from(invoices);
    const r = rows[0];
    return {
      openCents: r?.openCents ?? 0,
      overdueCents: r?.overdueCents ?? 0,
      openCount: r?.openCount ?? 0,
    };
  }

  async count(filter?: InvoiceFilter): Promise<number> {
    const rows = await this.tx
      .select({ n: sql<number>`count(*)::int` })
      .from(invoices)
      .where(and(...this.listConds(filter)));
    return rows[0]?.n ?? 0;
  }

  list(
    page: CursorPage,
    filter?: InvoiceFilter,
    sort?: InvoiceSort,
    sortDir?: "asc" | "desc",
  ): Promise<Paginated<Invoice>> {
    return this.loadHeaderPage(this.listConds(filter), page, sort, sortDir);
  }

  listByLead(leadId: LeadId, page: CursorPage): Promise<Paginated<Invoice>> {
    return this.loadHeaderPage([isNull(invoices.deletedAt), eq(invoices.leadId, leadId)], page);
  }

  findOverdue(now: Date, page: CursorPage): Promise<Paginated<Invoice>> {
    return this.loadHeaderPage(
      [isNull(invoices.deletedAt), inArray(invoices.status, [...OPEN_STATUSES]), lt(invoices.dueAt, now)],
      page,
    );
  }

  // --- helpers ---

  private async hydrate(header: typeof invoices.$inferSelect): Promise<Invoice> {
    const [lineRows, paymentRows] = await Promise.all([
      this.tx
        .select()
        .from(invoiceLines)
        .where(and(eq(invoiceLines.invoiceId, header.id), isNull(invoiceLines.deletedAt))),
      this.tx.select().from(payments).where(eq(payments.invoiceId, header.id)),
    ]);
    return toDomain(header, lineRows, paymentRows);
  }

  private async diffLines(invoice: Invoice): Promise<void> {
    const p = invoice.props;
    const keptIds = p.lines.map((line) => line.props.id);
    if (p.lines.length > 0) {
      await this.upsertLines(p.id, p.orgId, p.lines, p.updatedAt);
    }
    const removeConds = [eq(invoiceLines.invoiceId, p.id), isNull(invoiceLines.deletedAt)];
    if (keptIds.length > 0) removeConds.push(notInArray(invoiceLines.id, keptIds));
    await this.tx.update(invoiceLines).set({ deletedAt: p.updatedAt }).where(and(...removeConds));
  }

  private async upsertLines(
    invoiceId: string,
    orgId: OrgId,
    lines: readonly InvoiceLine[],
    updatedAt: Date,
  ): Promise<void> {
    const rows = lines.map((line) => {
      const lp = line.props;
      return {
        id: lp.id,
        orgId,
        invoiceId,
        sourceJobLineId: lp.sourceJobLineId,
        description: lp.description,
        quantity: lp.quantity,
        rateCents: lp.rate,
        costCents: lp.cost,
        position: lp.position,
        updatedAt,
        deletedAt: null as Date | null,
      };
    });
    await this.tx
      .insert(invoiceLines)
      .values(rows)
      .onConflictDoUpdate({
        target: invoiceLines.id,
        set: {
          sourceJobLineId: sql`excluded.source_job_line_id`,
          description: sql`excluded.description`,
          quantity: sql`excluded.quantity`,
          rateCents: sql`excluded.rate_cents`,
          costCents: sql`excluded.cost_cents`,
          position: sql`excluded.position`,
          updatedAt: sql`excluded.updated_at`,
          deletedAt: sql`excluded.deleted_at`,
        },
      });
  }

  private async loadHeaderPage(
    baseConds: SQL[],
    page: CursorPage,
    sort?: InvoiceSort,
    sortDir?: "asc" | "desc",
  ): Promise<Paginated<Invoice>> {
    const conds = [...baseConds];
    const spec = sort ? invoiceSortSpec(sort, sortDir) : null;
    if (page.cursor) {
      if (spec) {
        const c = decodeSortCursor(page.cursor);
        if (c) {
          const after = keysetAfterSort(spec, invoices.id, c);
          if (after) conds.push(after);
        }
      } else {
        const cursor = decodeCursor(page.cursor);
        if (isOk(cursor)) conds.push(keysetBefore(invoices.createdAt, invoices.id, cursor.value));
      }
    }
    const order = spec ? orderFor(spec, invoices.id) : [desc(invoices.createdAt), desc(invoices.id)];

    // Header-only: balance math uses denormalized amount_paid_cents, so lines/payments aren't loaded.
    if (!spec) {
      const rows = await this.tx
        .select()
        .from(invoices)
        .where(and(...conds))
        .orderBy(...order)
        .limit(page.limit + 1);
      return buildPage(
        rows.map((row) => toDomain(row, [], [])),
        page,
        (invoice) => ({ createdAt: invoice.props.createdAt, id: invoice.props.id }),
      );
    }

    // The sorted path selects the sort column a SECOND time, cast to text, and builds the cursor
    // from that rather than from the mapped row. See sortValueColumn: a timestamptz round-tripped
    // through a JS Date loses microseconds, and a cursor built from the truncated value matches
    // its own row again — so every page repeated the previous page's last row.
    const rows = await this.tx
      .select({ row: invoices, sortValue: sortValueColumn(spec) })
      .from(invoices)
      .where(and(...conds))
      .orderBy(...order)
      .limit(page.limit + 1);

    const hasMore = rows.length > page.limit;
    const kept = hasMore ? rows.slice(0, page.limit) : rows;
    const last = kept[kept.length - 1];
    return {
      items: kept.map((r) => toDomain(r.row, [], [])),
      nextCursor: hasMore && last ? encodeSortCursor({ value: last.sortValue, id: last.row.id }) : null,
    };
  }
}
