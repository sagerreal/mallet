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
  findById(id: InvoiceId): Promise<Invoice | null>;
  findBySourceJob(jobId: JobId): Promise<Invoice | null>;
  list(page: CursorPage, filter?: InvoiceFilter): Promise<Paginated<Invoice>>;
  listByLead(leadId: LeadId, page: CursorPage): Promise<Paginated<Invoice>>;
  findOverdue(now: Date, page: CursorPage): Promise<Paginated<Invoice>>;
}
