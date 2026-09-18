import type { Clock, Result, ExternalServiceError } from "@mallet/shared/types";
import { ok } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import type {
  NotificationSender,
  SendNotificationCmd,
  NotificationReceipt,
} from "../domain/notification-sender";

// Fallback binding: records the message to the log and returns success without any external call —
// used per-channel by the ChannelRouter when a real provider (Resend/Twilio) is unconfigured. Does
// not log the recipient (PII). Returns a distinguishable sentinel externalId so a stubbed no-op is
// NOT indistinguishable from a real provider delivery (a real send returns re_.../SM... ids) — the
// notification row records STUB_EXTERNAL_ID, making "logged but not actually sent" observable.
export const STUB_EXTERNAL_ID = "stub:logged";

export class LoggingNotificationSender implements NotificationSender {
  constructor(private readonly clock: Clock) {}

  async send(cmd: SendNotificationCmd): Promise<Result<NotificationReceipt, ExternalServiceError>> {
    logger.info({ channel: cmd.channel, kind: cmd.kind }, "notification.stub.send");
    return ok({ externalId: STUB_EXTERNAL_ID, channel: cmd.channel, sentAt: this.clock.now() });
  }
}
