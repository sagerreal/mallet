import { asInvoiceId, asOrgId, asLeadId, asJobId, money } from "@mallet/shared/types";
import { invoices, invoiceLines, payments } from "@mallet/shared/db/schema";
import { Invoice, isInvoiceStatus } from "../domain/invoice";
import { InvoiceLine } from "../domain/invoice-line";
import { Payment, isPaymentMethod } from "../domain/payment";

export type InvoiceRow = typeof invoices.$inferSelect;
export type InvoiceLineRow = typeof invoiceLines.$inferSelect;
export type PaymentRow = typeof payments.$inferSelect;

const toLine = (row: InvoiceLineRow): InvoiceLine => {
  const r = InvoiceLine.create({
    id: row.id,
    sourceJobLineId: row.sourceJobLineId,
    description: row.description,
    quantity: row.quantity,
    rate: money(row.rateCents),
    cost: money(row.costCents),
    position: row.position,
  });
  if (!r.ok) throw new Error(`corrupt invoice_line ${row.id}: ${r.error.message}`);
  return r.value;
};

const toPayment = (row: PaymentRow): Payment => {
  if (!isPaymentMethod(row.method)) {
    throw new Error(`corrupt payment ${row.id}: unknown method "${row.method}"`);
  }
  const r = Payment.create({
    id: row.id,
    amount: money(row.amountCents),
    method: row.method,
    idempotencyKey: row.idempotencyKey,
    externalId: row.externalId,
    receivedAt: row.receivedAt,
  });
  if (!r.ok) throw new Error(`corrupt payment ${row.id}: ${r.error.message}`);
  return r.value;
};

// Reconstruct the aggregate. lineRows/paymentRows are empty for header-only (list) reads — the
// balance math relies on the denormalized amount_paid_cents, not on loading the ledger.
export const toDomain = (
  row: InvoiceRow,
  lineRows: readonly InvoiceLineRow[],
  paymentRows: readonly PaymentRow[],
): Invoice => {
  if (!isInvoiceStatus(row.status)) {
    throw new Error(`corrupt invoice ${row.id}: unknown status "${row.status}"`);
  }
  const lines = [...lineRows].sort((a, b) => a.position - b.position).map(toLine);
  const payments = [...paymentRows]
    .sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime())
    .map(toPayment);

  const result = Invoice.create({
    id: asInvoiceId(row.id),
    orgId: asOrgId(row.orgId),
    num: row.num,
    sourceJobId: row.sourceJobId ? asJobId(row.sourceJobId) : null,
    leadId: asLeadId(row.leadId),
    title: row.title,
    status: row.status,
    total: money(row.totalCents),
    taxBps: row.taxBps,
    tax: money(row.taxCents),
    depositPaid: money(row.depositPaidCents),
    amountPaid: money(row.amountPaidCents),
    payments,
    lines,
    termsDays: row.termsDays,
    sentAt: row.sentAt,
    dueAt: row.dueAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
  if (!result.ok) throw new Error(`corrupt invoice ${row.id}: ${result.error.message}`);
  return result.value;
};
