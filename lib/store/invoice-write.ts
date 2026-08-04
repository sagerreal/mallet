/**
 * lib/store/invoice-write.ts
 * Where an invoice write goes, and nothing else — the twin of visit-status-write.ts. The store
 * slice keeps the optimistic / reconcile / rollback mechanics; this file only picks the endpoint
 * and maps whatever comes back into a store Invoice.
 *
 * Two APIs move the same money for different callers:
 *   • v1.invoicing.*      — ownerOrOffice. The desk's surface: the whole receivables book, the
 *                           customer's pay-link token, line cost, void, re-pricing.
 *   • v1.fieldInvoicing.* — anyRole, but every procedure is authorized against the JOB the invoice
 *                           links to (`Job.isAssignedTo` + job status `complete`), and every one
 *                           answers with a REDACTED shape: no cost at any setting, no pay-link
 *                           token, no signed amount. See modules/invoicing/api/field-invoice-*.
 *
 * The two return DIFFERENT wire shapes on purpose — the field DTO is a separate type, never a
 * filtered copy — so the choice of mapper belongs beside the choice of endpoint. Callers get a
 * store `Invoice` either way and never hold a raw DTO whose provenance they'd have to remember.
 *
 * A technician reaching an office procedure must be impossible BY CONSTRUCTION, not by luck: the
 * field surfaces pass `surface: "field"` once, at the top of the component, and every money call
 * below them comes through here.
 */

import { trpcVanilla } from "@/lib/trpc/vanilla";
import { dtoInvoiceToStore, dtoFieldInvoiceToStore } from "@/lib/store/dto-mapper";
import type { Invoice } from "@/lib/store/types";

/**
 * Which API an invoice write is made against. The store holds no identity of its own, so the
 * caller supplies this — the field surfaces already resolve the role for their own rendering.
 */
export type InvoiceWriteSurface = "field" | "office";

/** The payment methods both routers accept (their shared zod enum). */
export type InvoicePaymentMethod = "card" | "ach" | "cash" | "check" | "card_terminal";

export interface RecordPaymentArgs {
  readonly invoiceId: string;
  readonly amountCents: number;
  readonly method: InvoicePaymentMethod;
  readonly idempotencyKey: string;
}

const onField = (surface: InvoiceWriteSurface): boolean => surface === "field";

/**
 * Raise the bill for a finished job. Idempotent per job on BOTH surfaces (the server dedupes on
 * `invoices_org_source_job_uidx`), so a retry resumes rather than mints.
 */
export function persistInvoiceFromJob(
  surface: InvoiceWriteSurface,
  args: { jobId: string; id: string },
  prior: Invoice,
): Promise<Invoice> {
  return onField(surface)
    ? trpcVanilla.v1.fieldInvoicing.createFromJob
        .mutate(args)
        .then((dto) => dtoFieldInvoiceToStore(dto, prior))
    : trpcVanilla.v1.invoicing.createFromJob.mutate(args).then((dto) => dtoInvoiceToStore(dto, prior));
}

/**
 * Read one invoice back.
 *
 * The close-out needs this twice: once before recording a payment (the customer may have just
 * paid the QR while the technician reached for "record it instead") and once per poll while the
 * checkout code is on screen. Without a field route the card path never flips to paid on a
 * technician's screen.
 */
export function readInvoice(
  surface: InvoiceWriteSurface,
  invoiceId: string,
  prior: Invoice,
): Promise<Invoice> {
  return onField(surface)
    ? trpcVanilla.v1.fieldInvoicing.get
        .query({ invoiceId })
        .then((dto) => dtoFieldInvoiceToStore(dto, prior))
    : trpcVanilla.v1.invoicing.get.query({ invoiceId }).then((dto) => dtoInvoiceToStore(dto, prior));
}

/**
 * draft → sent. Unavoidable before collecting on either surface: both the record and the checkout
 * use-cases refuse a draft, so nobody can take money without it.
 */
export function persistSendInvoice(
  surface: InvoiceWriteSurface,
  invoiceId: string,
  prior: Invoice,
): Promise<Invoice> {
  return onField(surface)
    ? trpcVanilla.v1.fieldInvoicing.send
        .mutate({ invoiceId })
        .then((dto) => dtoFieldInvoiceToStore(dto, prior))
    : trpcVanilla.v1.invoicing.send.mutate({ invoiceId }).then((dto) => dtoInvoiceToStore(dto, prior));
}

/** Cash, check or bank taken at the door. The field route stamps who took it. */
export function persistRecordPayment(
  surface: InvoiceWriteSurface,
  args: RecordPaymentArgs,
  prior: Invoice,
): Promise<Invoice> {
  return onField(surface)
    ? trpcVanilla.v1.fieldInvoicing.recordPayment
        .mutate(args)
        .then((dto) => dtoFieldInvoiceToStore(dto, prior))
    : trpcVanilla.v1.invoicing.recordPayment.mutate(args).then((dto) => dtoInvoiceToStore(dto, prior));
}

/** Mint the Stripe checkout the customer scans. Charges the FULL balance on both surfaces. */
export function mintCheckoutSession(
  surface: InvoiceWriteSurface,
  invoiceId: string,
): Promise<{ url: string }> {
  return onField(surface)
    ? trpcVanilla.v1.fieldInvoicing.createPayment.mutate({ invoiceId })
    : trpcVanilla.v1.invoicing.createPayment.mutate({ invoiceId });
}

/**
 * Charge the shop's trip fee on a scoping visit the customer declined.
 *
 * ONE server path for office and field alike — `raiseVisitFee` is `anyRole` and job-authorized, so
 * there is no office variant to pick between and no `surface` argument here. It replaces the old
 * client-side draft+send dance against `v1.invoicing.draft`, which was office-only (a technician
 * standing at the door got FORBIDDEN) and stamped no `scope_job_id`, leaving the fee invoice
 * unreachable by the very person who was supposed to collect it.
 *
 * **`jobId` IS THE WHOLE INPUT.** No invoice id: the guard authorizes the JOB and has no way to
 * say anything about an id, so a caller-supplied one would be an unchecked write target ("raise a
 * fee on my own job, into *that* invoice"). No amount either: the server reads it from the shop's
 * settings, so the person holding the tablet cannot choose what the customer is charged. The
 * server mints the row and this adopts what it returns.
 */
export function raiseVisitFee(jobId: string, prior?: Invoice): Promise<Invoice> {
  return trpcVanilla.v1.fieldInvoicing.raiseVisitFee
    .mutate({ jobId })
    .then((dto) => dtoFieldInvoiceToStore(dto, prior));
}
