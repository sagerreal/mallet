import { and, desc, eq, isNull, lt, inArray, notInArray, sql, type SQL } from "drizzle-orm";
import { invoices, invoiceLines, payments } from "@mallet/shared/db/schema";
import type { TenantTx } from "@mallet/shared/db/tx";
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
import type { InvoiceRepository, InvoiceFilter } from "../domain/invoice-repository";
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
      depositPaidCents: p.depositPaid,
      amountPaidCents: p.amountPaid,
      termsDays: p.termsDays,
      sentAt: p.sentAt,
      dueAt: p.dueAt,
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
      .values({ id: p.id, orgId: p.orgId, createdAt: p.createdAt, ...columns })
      .onConflictDoUpdate({ target: invoices.id, set: updatable });
    await this.diffLines(invoice);
  }

  // Atomically apply a payment to the denormalized header: increment amount_paid_cents and
  // recompute status IN ONE UPDATE, so concurrent distinct-key payments serialize on the row lock
  // and never lose an update under READ COMMITTED. Mirrors Invoice.recordPayment's rule; callers
  // guarantee the invoice is 'sent' or 'partial' first. Returns the re-hydrated aggregate.
  async applyPayment(invoiceId: InvoiceId, amountCents: number): Promise<Invoice | null> {
    await this.tx.execute(sql`
      update invoices
      set amount_paid_cents = amount_paid_cents + ${amountCents},
          status = case
            when total_cents - deposit_paid_cents - (amount_paid_cents + ${amountCents}) <= 0
            then 'paid' else 'partial' end,
          updated_at = now()
      where id = ${invoiceId} and deleted_at is null
    `);
    return this.findById(invoiceId);
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

  list(page: CursorPage, filter?: InvoiceFilter): Promise<Paginated<Invoice>> {
    const conds: SQL[] = [isNull(invoices.deletedAt)];
    if (filter?.status) conds.push(eq(invoices.status, filter.status));
    return this.loadHeaderPage(conds, page);
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
    const keptIds: string[] = [];
    for (const line of p.lines) {
      keptIds.push(line.props.id);
      await this.upsertLine(p.id, p.orgId, line, p.updatedAt);
    }
    const removeConds = [eq(invoiceLines.invoiceId, p.id), isNull(invoiceLines.deletedAt)];
    if (keptIds.length > 0) removeConds.push(notInArray(invoiceLines.id, keptIds));
    await this.tx.update(invoiceLines).set({ deletedAt: p.updatedAt }).where(and(...removeConds));
  }

  private async upsertLine(
    invoiceId: string,
    orgId: OrgId,
    line: InvoiceLine,
    updatedAt: Date,
  ): Promise<void> {
    const lp = line.props;
    const columns = {
      sourceJobLineId: lp.sourceJobLineId,
      description: lp.description,
      quantity: lp.quantity,
      rateCents: lp.rate,
      costCents: lp.cost,
      position: lp.position,
      updatedAt,
      deletedAt: null,
    };
    await this.tx
      .insert(invoiceLines)
      .values({ id: lp.id, orgId, invoiceId, ...columns })
      .onConflictDoUpdate({ target: invoiceLines.id, set: columns });
  }

  private async loadHeaderPage(baseConds: SQL[], page: CursorPage): Promise<Paginated<Invoice>> {
    const conds = [...baseConds];
    if (page.cursor) {
      const cursor = decodeCursor(page.cursor);
      if (isOk(cursor)) {
        conds.push(
          sql`(${invoices.createdAt}, ${invoices.id}) < (${cursor.value.createdAt}::timestamptz, ${cursor.value.id}::uuid)`,
        );
      }
    }
    const rows = await this.tx
      .select()
      .from(invoices)
      .where(and(...conds))
      .orderBy(desc(invoices.createdAt), desc(invoices.id))
      .limit(page.limit + 1);
    // Header-only: balance math uses denormalized amount_paid_cents, so lines/payments aren't loaded.
    return buildPage(
      rows.map((row) => toDomain(row, [], [])),
      page,
      (invoice) => ({ createdAt: invoice.props.createdAt, id: invoice.props.id }),
    );
  }
}
