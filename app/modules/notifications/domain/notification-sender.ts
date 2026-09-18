import type { OrgId, Result, ExternalServiceError } from "@mallet/shared/types";
import type { NotificationChannel } from "./notification";

export interface SendNotificationCmd {
  readonly orgId: OrgId;
  readonly channel: NotificationChannel;
  readonly to: string;
  readonly body: string;
  readonly kind: string;
  readonly idempotencyKey: string;
}

export interface NotificationReceipt {
  readonly externalId: string | null; // provider message id later; null for the stub
  readonly channel: NotificationChannel;
  readonly sentAt: Date;
}

// Sends a message over a channel. Pilot binding: logging stubs. Real Twilio/Resend adapters
// implement the same port later, wrapping platform/resilience call() with a circuit breaker.
// Injected — never constructed in domain/app code. Mirrors PaymentGateway.
export interface NotificationSender {
  send(cmd: SendNotificationCmd): Promise<Result<NotificationReceipt, ExternalServiceError>>;
}
