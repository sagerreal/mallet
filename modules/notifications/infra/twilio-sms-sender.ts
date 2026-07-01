import twilio, { type Twilio } from "twilio";
import type { Clock, Result, ExternalServiceError } from "@mallet/shared/types";
import { ok, err, externalService } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import { call, CircuitBreaker } from "@mallet/platform/resilience";
import type {
  NotificationSender,
  SendNotificationCmd,
  NotificationReceipt,
} from "../domain/notification-sender";

// Real SMS adapter behind the NotificationSender port (the ONLY file importing the Twilio SDK).
// messages.create is NOT idempotent (no per-message key), so it is NOT retried — a retry could send
// a second text. The caller (SendNotificationUseCase) already claims the idempotency key at the
// ledger before calling us, so a single attempt is correct; a failure surfaces as status=failed
// (graceful degradation), not a rollback. Never logs the recipient or body (PII).
export class TwilioSmsSender implements NotificationSender {
  private readonly client: Twilio;
  private readonly breaker = new CircuitBreaker("twilio", { failureThreshold: 5, resetMs: 30_000 });

  constructor(
    accountSid: string,
    authToken: string,
    private readonly from: string,
    private readonly clock: Clock,
  ) {
    this.client = twilio(accountSid, authToken);
  }

  async send(cmd: SendNotificationCmd): Promise<Result<NotificationReceipt, ExternalServiceError>> {
    try {
      const message = await call(
        () => this.client.messages.create({ to: cmd.to, from: this.from, body: cmd.body }),
        { idempotent: false, timeoutMs: 10_000, breaker: this.breaker },
      );
      return ok({ externalId: message.sid, channel: cmd.channel, sentAt: this.clock.now() });
    } catch (e) {
      logger.error(
        { provider: "twilio", kind: cmd.kind, err: e instanceof Error ? e.message : String(e) },
        "twilio.send failed",
      );
      return err(externalService("twilio", "the sms provider is temporarily unavailable", true));
    }
  }
}
