// Public surface for the invoicing module — the only sanctioned import seam (architecture rule).
export { createInvoiceRouter } from "./api/invoice-router";
// The technician's field-scoped money surface. Only the factory is public: the scope port, its
// adapter, the guard and the redacted DTO stay module-private, so the redaction cannot be
// bypassed by reaching around the router.
export { createFieldInvoiceRouter } from "./api/field-invoice-router";
// Stripe Terminal (Tap to Pay) server plumbing — connection tokens, the org's location, tap
// intents and the device-driven reconcile. Same seam discipline as the field router: only the
// factory and the DI-facing gateway are public.
export { createTerminalRouter } from "./api/terminal-router";
export type { TerminalGateway } from "./domain/terminal-gateway";
export { StripeTerminalGateway } from "./infra/stripe-terminal-gateway";
// The one sentinel naming a visit-fee invoice — shared so the client's duplicate-collection guard
// and the server's idempotency check are the SAME string rather than two that agree today.
export { VISIT_FEE_TITLE } from "./app/raise-visit-fee";
export type { Invoice, InvoiceStatus, InvoiceProps } from "./domain/invoice";
export { INVOICE_STATUSES } from "./domain/invoice";
export type { PaymentMethod } from "./domain/payment";
export { PAYMENT_METHODS } from "./domain/payment";
export type { InvoiceRepository } from "./domain/invoice-repository";
export type { JobReader } from "./domain/job-reader";
export type { EstimateDepositReader } from "./domain/estimate-deposit-reader";
export type { PaymentGateway } from "./domain/payment-gateway";
export type { PaymentLinkGateway } from "./domain/payment-link-gateway";
export { StripePaymentLinkGateway } from "./infra/stripe-payment-link-gateway";
// Exposed for the Stripe webhook route (records via the same tenant-scoped repo path).
export { DrizzleInvoiceRepository } from "./infra/drizzle-invoice-repository";
// Exposed for the AI invoice_create_from_job tool — ONE JobReader adapter, so the
// unpriced-estimate guard reads the same priced-ness everywhere.
export { DrizzleJobReader } from "./infra/drizzle-job-reader";
// Same seam, same reason: the AI tool credits the estimate deposit exactly like the router does.
export { DrizzleEstimateDepositReader } from "./infra/drizzle-estimate-deposit-reader";
export { RecordCardPaymentUseCase } from "./app/record-card-payment";
export { processStripeEvent } from "./app/stripe-webhook";
// Success-page reconcile — same recorder wiring as the webhook, exposed for its public route.
export { reconcileCheckoutSession } from "./app/reconcile-checkout";
export type { ReconcileCheckoutDeps, ReconcileOutcome } from "./app/reconcile-checkout";
export { DraftInvoiceUseCase } from "./app/draft-invoice";
export { CreateInvoiceFromJobUseCase } from "./app/create-invoice-from-job";
export { CreatePaymentUseCase } from "./app/create-payment";
export { SendInvoiceUseCase } from "./app/send-invoice";
export { RecordPaymentUseCase } from "./app/record-payment";
export { VoidInvoiceUseCase } from "./app/void-invoice";
export { ListInvoicesUseCase } from "./app/list-invoices";
export { UpdateInvoiceMetadataUseCase } from "./app/update-invoice-metadata";
export { PatchInvoiceLinesUseCase } from "./app/patch-invoice-lines";
// Relay handler (invoice.paid) — internal, idempotent; exercises the outbox relay under RLS.
export { InvoicePaidAuditHandler } from "./app/invoice-paid-audit-handler";
export { ManualPaymentGateway } from "./infra/manual-payment-gateway";
