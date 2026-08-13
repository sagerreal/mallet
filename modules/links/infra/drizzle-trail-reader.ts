import "server-only";
import { and, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { leads, estimates, jobs, invoices } from "@mallet/shared/db/schema";
import type { TenantTx } from "@mallet/shared/db/tx";

/**
 * modules/links/infra/drizzle-trail-reader.ts
 * The customer › quote › job › invoice trail, for whichever of the four you are looking at.
 *
 * WHY THIS IS A READ MODEL AND NOT FOUR CLIENT-SIDE JOINS.
 * Every link already exists as a column — estimates.lead_id, jobs.lead_id +
 * jobs.source_estimate_id, invoices.lead_id + invoices.source_job_id — so the FORWARD hops are free
 * on the record itself. The three REVERSE hops are not: "this customer's jobs", "the job this quote
 * produced", "the invoice raised from this job". Each of those is a lookup, and the browser holds
 * one page of each collection, so a client-side join silently misses anything past it. That is
 * exactly the failure that put "—" in the Jobs list's customer column and made the Money screen's
 * Archived tab unable to find a void invoice. One read, in SQL, or the trail lies the same way.
 *
 * THE CHAIN IS 1:1 DOWNSTREAM OF A CUSTOMER, and two unique indexes enforce it:
 *
 *   jobs_org_source_estimate_uidx      (org_id, source_estimate_id) where not null, not deleted
 *   invoices_org_source_job_uidx       (org_id, source_job_id)      where not null, not deleted
 *
 * So a quote produces at most ONE job and a job carries at most ONE invoice. Only the CUSTOMER
 * anchor is ever plural — they accumulate quotes, jobs and invoices over years. That is why the cap
 * and the counts below matter on that anchor and are structurally 0-or-1 on the other three.
 *
 * SCOPE, per anchor:
 *   customer — everything of theirs: all their quotes, all their jobs, all their invoices.
 *   quote    — the customer, the job it produced, the invoice raised from that job.
 *   job      — the customer, the quote it came from, the invoice raised from it.
 *   invoice  — the customer, the job it came from, and the quote that job came from.
 *
 * ORG-SCOPED on every table, and soft-deletes excluded, like every other read. Void invoices are
 * excluded for the same reason the Money bands exclude them: a cancelled bill is not part of the
 * live chain.
 */

export type TrailKind = "customer" | "quote" | "job" | "invoice";

export interface TrailCustomer {
  readonly id: string;
  readonly name: string;
}
export interface TrailQuote {
  readonly id: string;
  readonly num: string;
  readonly status: string;
}
export interface TrailJob {
  readonly id: string;
  readonly title: string | null;
  readonly status: string;
  readonly completedAt: string | null;
}
export interface TrailInvoice {
  readonly id: string;
  readonly num: string;
  readonly status: string;
  readonly totalCents: number;
  readonly owedCents: number;
  readonly dueAt: string | null;
}

export interface TrailCounts {
  readonly quotes: number;
  readonly jobs: number;
  readonly invoices: number;
}

export interface Trail {
  readonly customer: TrailCustomer | null;
  readonly quotes: readonly TrailQuote[];
  readonly jobs: readonly TrailJob[];
  readonly invoices: readonly TrailInvoice[];
  /**
   * The TRUE totals, uncapped — what the trail's label says ("40 jobs").
   *
   * Not `rows.length`: the arrays are capped at TRAIL_CAP, so a customer with forty jobs would
   * otherwise read "6 jobs" and the label would be a lie about the size of their history. Taken
   * from `count(*) over()` in the same query as the rows, so it costs no extra round trip.
   */
  readonly counts: TrailCounts;
}

/** Postgres timestamps come back as Date; the wire format is an ISO string. Normalised at the read
 *  boundary, per the house rule — never in the router, never in the component. */
const iso = (d: Date | string | null): string | null =>
  d === null ? null : d instanceof Date ? d.toISOString() : d;

const EMPTY: Trail = { customer: null, quotes: [], jobs: [], invoices: [], counts: { quotes: 0, jobs: 0, invoices: 0 } };

/** The uncapped total rides on every row; take it from the first, or 0 when there are none. */
const totalOf = (rows: readonly { total: number }[]): number => rows[0]?.total ?? 0;

/**
 * How many related records the trail returns per type.
 *
 * The trail's list is a chooser, not a list view — a customer with forty jobs needs the Jobs screen
 * filtered to them, not forty rows inside a modal header. The client shows the count from `counts`
 * (which is NOT capped) and offers "see all" past this many.
 */
export const TRAIL_CAP = 6;

export class DrizzleTrailReader {
  constructor(
    private readonly tx: TenantTx,
    private readonly orgId: string,
  ) {}

  async forKind(kind: TrailKind, id: string): Promise<Trail> {
    switch (kind) {
      case "customer":
        return this.fromCustomer(id);
      case "quote":
        return this.fromQuote(id);
      case "job":
        return this.fromJob(id);
      case "invoice":
      default:
        return this.fromInvoice(id);
    }
  }

  // ── the pieces ────────────────────────────────────────────────────────────

  private async customerById(leadId: string): Promise<TrailCustomer | null> {
    const rows = await this.tx
      .select({ id: leads.id, name: leads.name })
      .from(leads)
      .where(and(eq(leads.orgId, this.orgId), eq(leads.id, leadId)))
      .limit(1);
    const r = rows[0];
    return r ? { id: r.id, name: r.name } : null;
  }

  private quotesWhere(extra: ReturnType<typeof eq>) {
    return this.tx
      .select({
        id: estimates.id, num: estimates.num, status: estimates.status,
        total: sql<number>`count(*) over()::int`,
      })
      .from(estimates)
      .where(and(eq(estimates.orgId, this.orgId), isNull(estimates.deletedAt), extra))
      .orderBy(desc(estimates.createdAt))
      .limit(TRAIL_CAP);
  }

  private async jobsWhere(extra: ReturnType<typeof eq>) {
    const rows = await this.tx
      .select({
        id: jobs.id, title: jobs.title, status: jobs.status, completedAt: jobs.completedAt,
        total: sql<number>`count(*) over()::int`,
      })
      .from(jobs)
      .where(and(eq(jobs.orgId, this.orgId), isNull(jobs.deletedAt), extra))
      .orderBy(desc(jobs.createdAt))
      .limit(TRAIL_CAP);
    return rows.map((r) => ({ ...r, completedAt: iso(r.completedAt) }));
  }

  /** Void excluded: a cancelled bill is not part of the live chain (same rule as the Money bands). */
  private async invoicesWhere(extra: ReturnType<typeof eq> | ReturnType<typeof inArray>) {
    const rows = await this.tx
      .select({
        id: invoices.id,
        num: invoices.num,
        status: invoices.status,
        totalCents: invoices.totalCents,
        owedCents: sql<number>`greatest(0, ${invoices.totalCents} - ${invoices.depositPaidCents} - ${invoices.amountPaidCents})::int`,
        dueAt: invoices.dueAt,
        total: sql<number>`count(*) over()::int`,
      })
      .from(invoices)
      .where(
        and(
          eq(invoices.orgId, this.orgId),
          isNull(invoices.deletedAt),
          ne(invoices.status, "void"),
          extra,
        ),
      )
      .orderBy(desc(invoices.createdAt))
      .limit(TRAIL_CAP);
    return rows.map((r) => ({ ...r, dueAt: iso(r.dueAt) }));
  }

  // ── the four anchors ──────────────────────────────────────────────────────

  private async fromCustomer(leadId: string): Promise<Trail> {
    const [customer, quotes, jobRows, invoiceRows] = await Promise.all([
      this.customerById(leadId),
      this.quotesWhere(eq(estimates.leadId, leadId)),
      this.jobsWhere(eq(jobs.leadId, leadId)),
      this.invoicesWhere(eq(invoices.leadId, leadId)),
    ]);
    if (!customer) return EMPTY;
    return {
      customer, quotes, jobs: jobRows, invoices: invoiceRows,
      counts: { quotes: totalOf(quotes), jobs: totalOf(jobRows), invoices: totalOf(invoiceRows) },
    };
  }

  private async fromQuote(quoteId: string): Promise<Trail> {
    const self = await this.tx
      .select({ id: estimates.id, num: estimates.num, status: estimates.status, leadId: estimates.leadId })
      .from(estimates)
      .where(and(eq(estimates.orgId, this.orgId), eq(estimates.id, quoteId), isNull(estimates.deletedAt)))
      .limit(1);
    const q = self[0];
    if (!q) return EMPTY;

    // The job(s) this quote produced, then the invoices raised from those jobs.
    const jobRows = await this.jobsWhere(eq(jobs.sourceEstimateId, quoteId));
    const invoiceRows = jobRows.length
      ? await this.invoicesWhere(inArray(invoices.sourceJobId, jobRows.map((j) => j.id)))
      : [];
    return {
      customer: await this.customerById(q.leadId),
      quotes: [{ id: q.id, num: q.num, status: q.status }],
      jobs: jobRows,
      invoices: invoiceRows,
      counts: { quotes: 1, jobs: totalOf(jobRows), invoices: totalOf(invoiceRows) },
    };
  }

  private async fromJob(jobId: string): Promise<Trail> {
    const self = await this.tx
      .select({ id: jobs.id, title: jobs.title, status: jobs.status, completedAt: jobs.completedAt, leadId: jobs.leadId, sourceEstimateId: jobs.sourceEstimateId })
      .from(jobs)
      .where(and(eq(jobs.orgId, this.orgId), eq(jobs.id, jobId), isNull(jobs.deletedAt)))
      .limit(1);
    const j = self[0];
    if (!j) return EMPTY;

    const [customer, quotes, invoiceRows] = await Promise.all([
      this.customerById(j.leadId),
      j.sourceEstimateId ? this.quotesWhere(eq(estimates.id, j.sourceEstimateId)) : Promise.resolve([]),
      this.invoicesWhere(eq(invoices.sourceJobId, jobId)),
    ]);
    return {
      customer,
      quotes,
      jobs: [{ id: j.id, title: j.title, status: j.status, completedAt: iso(j.completedAt) }],
      invoices: invoiceRows,
      counts: { quotes: totalOf(quotes), jobs: 1, invoices: totalOf(invoiceRows) },
    };
  }

  private async fromInvoice(invoiceId: string): Promise<Trail> {
    const self = await this.tx
      .select({ id: invoices.id, leadId: invoices.leadId, sourceJobId: invoices.sourceJobId })
      .from(invoices)
      .where(and(eq(invoices.orgId, this.orgId), eq(invoices.id, invoiceId), isNull(invoices.deletedAt)))
      .limit(1);
    const inv = self[0];
    if (!inv) return EMPTY;

    const jobRows = inv.sourceJobId ? await this.jobsWhere(eq(jobs.id, inv.sourceJobId)) : [];
    const quoteId = jobRows.length ? await this.quoteIdOfJob(jobRows[0]!.id) : null;

    // Just this one. invoices_org_source_job_uidx means a job carries at most one live invoice, so
    // there are no siblings to find — asking by source_job_id would return this same row.
    const invoiceRows = await this.invoicesWhere(eq(invoices.id, invoiceId));

    const quotes = quoteId ? await this.quotesWhere(eq(estimates.id, quoteId)) : [];
    return {
      customer: await this.customerById(inv.leadId),
      quotes,
      jobs: jobRows,
      invoices: invoiceRows,
      counts: { quotes: totalOf(quotes), jobs: totalOf(jobRows), invoices: totalOf(invoiceRows) },
    };
  }

  private async quoteIdOfJob(jobId: string): Promise<string | null> {
    const rows = await this.tx
      .select({ sourceEstimateId: jobs.sourceEstimateId })
      .from(jobs)
      .where(and(eq(jobs.orgId, this.orgId), eq(jobs.id, jobId)))
      .limit(1);
    return rows[0]?.sourceEstimateId ?? null;
  }
}
