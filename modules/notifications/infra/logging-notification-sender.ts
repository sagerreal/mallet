import type { Clock, Result, ExternalServiceError } from "@mallet/shared/types";
import { ok } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import type {
  NotificationSender,
  SendNotificationCmd,
  NotificationReceipt,
} from "../domain/notification-sender";

// Pilot binding: records the message to the log and returns success without any external call.
// The real Twilio (sms) + Resend (email) adapters implement the same port later — likely split
// behind a channel router — wrapping platform/resilience call(). Does not log the recipient (PII).
export class LoggingNotificationSender implements NotificationSender {
  constructor(private readonly clock: Clock) {}

  async send(cmd: SendNotificationCmd): Promise<Result<NotificationReceipt, ExternalServiceError>> {
    logger.info({ channel: cmd.channel, kind: cmd.kind }, "notification.stub.send");
    return ok({ externalId: null, channel: cmd.channel, sentAt: this.clock.now() });
  }
}
