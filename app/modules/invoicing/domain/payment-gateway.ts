import type { OrgId, InvoiceId, Money, Result, ExternalServiceError } from "@mallet/shared/types";
import type { PaymentMethod } from "./payment";

export interface RecordPaymentGatewayCmd {
  readonly orgId: OrgId;
  readonly invoiceId: InvoiceId;
  readonly amount: Money;
  readonly method: PaymentMethod;
  readonly idempotencyKey: string;
}

export interface PaymentReceipt {
  readonly externalId: string | null; // Stripe payment id later; null for manual entries
  readonly amount: Money;
  readonly method: PaymentMethod;
  readonly settledAt: Date;
}

// Settles a payment. The pilot binding (ManualPaymentGateway) records cash/check/terminal as
// already-settled with no external call. A StripeGateway will implement the same port later,
// wrapping the charge in platform/resilience call(). Injected — never constructed in domain/app.
export interface PaymentGateway {
  recordPayment(cmd: RecordPaymentGatewayCmd): Promise<Result<PaymentReceipt, ExternalServiceError>>;
}
