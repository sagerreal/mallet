// Public surface for the invoicing module — the only sanctioned import seam (architecture rule).
export { createInvoiceRouter } from "./api/invoice-router";
export type { Invoice, InvoiceStatus, InvoiceProps } from "./domain/invoice";
export { INVOICE_STATUSES } from "./domain/invoice";
export type { PaymentMethod } from "./domain/payment";
export { PAYMENT_METHODS } from "./domain/payment";
export type { InvoiceRepository } from "./domain/invoice-repository";
export type { JobReader } from "./domain/job-reader";
export type { PaymentGateway } from "./domain/payment-gateway";
export type { PaymentLinkGateway } from "./domain/payment-link-gateway";
export { StripePaymentLinkGateway } from "./infra/stripe-payment-link-gateway";
// Exposed for the Stripe webhook route (records via the same tenant-scoped repo path).
export { DrizzleInvoiceRepository } from "./infra/drizzle-invoice-repository";
export { RecordCardPaymentUseCase } from "./app/record-card-payment";
export { processStripeEvent } from "./app/stripe-webhook";
export { DraftInvoiceUseCase } from "./app/draft-invoice";
export { CreateInvoiceFromJobUseCase } from "./app/create-invoice-from-job";
export { CreatePaymentUseCase } from "./app/create-payment";
export { SendInvoiceUseCase } from "./app/send-invoice";
export { RecordPaymentUseCase } from "./app/record-payment";
export { VoidInvoiceUseCase } from "./app/void-invoice";
export { ListInvoicesUseCase } from "./app/list-invoices";
