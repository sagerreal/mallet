import { Resend } from "resend";
import type { Clock, Result, ExternalServiceError } from "@mallet/shared/types";
import { ok, err, externalService } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import { call, CircuitBreaker } from "@mallet/platform/resilience";
import type {
  NotificationSender,
  SendNotificationCmd,
  NotificationReceipt,
} from "../domain/notification-sender";
import { emailSubjectFor } from "../templates/email-subject";

// The one bit of the Resend SDK we call — extracted as a seam so tests inject a fake and exercise
// the mapping without sending real email (a real send would spam the account owner every run).
export type EmailTransport = (
  payload: { from: string; to: string; subject: string; text: string },
  options: { idempotencyKey: string },
) => Promise<{ data: { id: string } | null; error: { message: string } | null }>;

// Real email adapter behind the NotificationSender port (the ONLY file importing the Resend SDK).
// Resend returns API-level failures in `error` (not thrown) — those are deterministic, so they are
// NOT retried and do NOT count toward the breaker; only a thrown network error is retried (safe:
// the Resend Idempotency-Key makes a retry a no-op rather than a second email). Never logs the
// recipient or body (PII).
export class ResendEmailSender implements NotificationSender {
  private readonly transport: EmailTransport;
  private readonly breaker = new CircuitBreaker("resend", { failureThreshold: 5, resetMs: 30_000 });

  constructor(
    apiKey: string,
    private readonly from: string,
    private readonly clock: Clock,
    transport?: EmailTransport,
  ) {
    const resend = new Resend(apiKey);
    this.transport = transport ?? ((payload, options) => resend.emails.send(payload, options));
  }

  async send(cmd: SendNotificationCmd): Promise<Result<NotificationReceipt, ExternalServiceError>> {
    try {
      const { data, error } = await call(
        () =>
          this.transport(
            { from: this.from, to: cmd.to, subject: emailSubjectFor(cmd.kind), text: cmd.body },
            { idempotencyKey: cmd.idempotencyKey },
          ),
        { idempotent: true, retries: 2, timeoutMs: 10_000, breaker: this.breaker },
      );
      if (error || !data) {
        logger.error({ provider: "resend", kind: cmd.kind, err: error?.message }, "resend.send rejected");
        return err(externalService("resend", "the email provider rejected the message", true));
      }
      return ok({ externalId: data.id, channel: cmd.channel, sentAt: this.clock.now() });
    } catch (e) {
      logger.error(
        { provider: "resend", kind: cmd.kind, err: e instanceof Error ? e.message : String(e) },
        "resend.send failed",
      );
      return err(externalService("resend", "the email provider is temporarily unavailable", true));
    }
  }
}
