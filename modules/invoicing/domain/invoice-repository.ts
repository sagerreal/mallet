import type { InvoiceSort } from "../infra/invoice-sorts";
import type {
  OrgId,
  InvoiceId,
  JobId,
  LeadId,
  CursorPage,
  Paginated,
} from "@mallet/shared/types";
import type { Invoice, InvoiceStatus } from "./invoice";
import type { Payment } from "./payment";

export interface InvoiceFilter {
  readonly status?: InvoiceStatus;
  /** Restrict to money still owed — the collection queue. */
  readonly unpaidOnly?: boolean;
  /** Free-text over invoice number, title and customer name. Matched in the database. */
  readonly search?: string;
}

// Outcome of an atomic applyPayment. `applied` is true iff the guarded UPDATE matched a payable
// (sent|partial) row and incremented it; false means the invoice was concurrently paid/voided (or
// never payable) and nothing was applied. `invoice` is the current invoice after the attempt, or
// null iff it does not exist. Callers key off `applied`, NOT off `invoice` alone — a not-applied
// invoice is still returned (now paid/void) and must be distinguished from an applied one.
export interface ApplyResult {
  readonly applied: boolean;
  readonly invoice: Invoice | null;
}

export interface InvoiceRepository {
  nextNumber(): Promise<string>;
  // Upsert the header + diff the display lines. Does NOT touch the payments ledger (see
  // insertPayment) — but writes the denormalized amount_paid_cents from the aggregate.
  save(invoice: Invoice): Promise<void>;
  // Idempotent create keyed on the source job (ON CONFLICT DO NOTHING RETURNING). true if inserted.
  insertForJob(invoice: Invoice): Promise<boolean>;
  // Append a payment to the ledger, deduped on (org_id, idempotency_key) via ON CONFLICT DO
  // NOTHING RETURNING. true if this call applied it; false if the key was already used.
  insertPayment(orgId: OrgId, invoiceId: InvoiceId, payment: Payment): Promise<boolean>;
  // Atomically increment amount_paid_cents and recompute status in ONE guarded UPDATE
  // (WHERE status in ('sent','partial')): no lost updates under concurrency, and a payment that
  // races a void/pay cannot resurrect the invoice. Returns whether it applied + the current invoice.
  applyPayment(invoiceId: InvoiceId, amountCents: number): Promise<ApplyResult>;
  findById(id: InvoiceId): Promise<Invoice | null>;
  findBySourceJob(jobId: JobId): Promise<Invoice | null>;
  list(page: CursorPage, filter?: InvoiceFilter, sort?: InvoiceSort, sortDir?: "asc" | "desc"): Promise<Paginated<Invoice>>;

  /** How many invoices match the filter, ignoring pagination. Same predicates as list(). */
  count(filter?: InvoiceFilter): Promise<number>;
  listByLead(leadId: LeadId, page: CursorPage): Promise<Paginated<Invoice>>;
  findOverdue(now: Date, page: CursorPage): Promise<Paginated<Invoice>>;
}
