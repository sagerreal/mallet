import twilio from "twilio";
import type { Clock, Result, ExternalServiceError } from "@mallet/shared/types";
import { ok, err, externalService } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import { call, CircuitBreaker } from "@mallet/platform/resilience";
import type {
  NotificationSender,
  SendNotificationCmd,
  NotificationReceipt,
} from "../domain/notification-sender";

// The one bit of the Twilio SDK we call — extracted as a seam so tests inject a fake and exercise
// the classification/breaker logic without a live account. messages.create THROWS on error; a
// Twilio RestException carries `.status` (HTTP) and `.code` (numeric Twilio code).
export type SmsTransport = (msg: { to: string; from: string; body: string }) => Promise<{ sid: string }>;

const errStatus = (e: unknown): number | undefined =>
  typeof (e as { status?: unknown }).status === "number" ? (e as { status: number }).status : undefined;
const errCode = (e: unknown): number | null =>
  typeof (e as { code?: unknown }).code === "number" ? (e as { code: number }).code : null;

// Real SMS adapter behind the NotificationSender port (the ONLY file importing the Twilio SDK).
// messages.create is NOT idempotent (no per-message key), so it is NOT retried — a retry could send
// a second text. Deterministic per-recipient rejections (4xx: invalid / unverified-trial / opted-out
// number) are returned as failures WITHOUT tripping the breaker — one bad number must not disable
// SMS for valid recipients; only 5xx / timeout / network re-throws to the breaker. Never logs the
// recipient or body, and never the provider's free-text message (it can embed the To number) — only
// the numeric code/status.
export class TwilioSmsSender implements NotificationSender {
  private readonly transport: SmsTransport;
  private readonly breaker = new CircuitBreaker("twilio", { failureThreshold: 5, resetMs: 30_000 });

  constructor(
    accountSid: string,
    authToken: string,
    private readonly from: string,
    private readonly clock: Clock,
    transport?: SmsTransport,
  ) {
    // timeout: the SDK aborts its OWN request at the deadline (it ignores the resilience
    // AbortSignal), so a timed-out send is actually cut off rather than orphaned and delivered.
    const client = twilio(accountSid, authToken, { timeout: 10_000 });
    this.transport = transport ?? ((msg) => client.messages.create(msg));
  }

  async send(cmd: SendNotificationCmd): Promise<Result<NotificationReceipt, ExternalServiceError>> {
    try {
      const result = await call(
        async (): Promise<{ sid: string } | { rejected: { code: number | null; status: number } }> => {
          try {
            const message = await this.transport({ to: cmd.to, from: this.from, body: cmd.body });
            return { sid: message.sid };
          } catch (e) {
            const status = errStatus(e);
            // 4xx = deterministic per-recipient rejection → resolve as a failure so the breaker does
            // NOT count it. 5xx / network / no-status → re-throw so the breaker counts a real outage.
            if (status !== undefined && status < 500) return { rejected: { code: errCode(e), status } };
            throw e;
          }
        },
        { idempotent: false, timeoutMs: 10_000, breaker: this.breaker },
      );
      if ("rejected" in result) {
        logger.error(
          { provider: "twilio", kind: cmd.kind, code: result.rejected.code, status: result.rejected.status },
          "twilio.send rejected",
        );
        return err(externalService("twilio", "the sms provider rejected the message", true));
      }
      return ok({ externalId: result.sid, channel: cmd.channel, sentAt: this.clock.now() });
    } catch (e) {
      // 5xx / timeout / network (breaker counted it) or an open breaker. Log only numeric
      // discriminators — never `.message`, which can embed the recipient number.
      logger.error({ provider: "twilio", kind: cmd.kind, code: errCode(e), status: errStatus(e) }, "twilio.send failed");
      return err(externalService("twilio", "the sms provider is temporarily unavailable", true));
    }
  }
}
