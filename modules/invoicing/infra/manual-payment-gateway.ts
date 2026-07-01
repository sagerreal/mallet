import type { Clock, Result, ExternalServiceError } from "@mallet/shared/types";
import { ok } from "@mallet/shared/types";
import type {
  PaymentGateway,
  RecordPaymentGatewayCmd,
  PaymentReceipt,
} from "../domain/payment-gateway";

// Pilot binding: cash / check / card-terminal / ACH are recorded as already-settled — no external
// call. The real StripeGateway will implement the same port and charge via platform/resilience.
export class ManualPaymentGateway implements PaymentGateway {
  constructor(private readonly clock: Clock) {}

  async recordPayment(
    cmd: RecordPaymentGatewayCmd,
  ): Promise<Result<PaymentReceipt, ExternalServiceError>> {
    return ok({
      externalId: null,
      amount: cmd.amount,
      method: cmd.method,
      settledAt: this.clock.now(),
    });
  }
}
