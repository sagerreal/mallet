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
// the mapping without sending real email. Resend RETURNS failures in `error` (never throws for
// API/network errors); `statusCode` is null on a network failure and the HTTP status otherwise.
export type EmailTransport = (
  payload: { from: string; to: string; subject: string; text: string },
  options: { idempotencyKey: string },
) => Promise<{
  data: { id: string } | null;
  error: { message: string; name?: string; statusCode?: number | null } | null;
}>;

// Thrown to convert a TRANSIENT Resend failure (network / 5xx / 429) into a rejection, so the
// resilience layer counts it toward the breaker and an idempotent retry can fire. Because Resend
// RETURNS all failures in `error` rather than throwing, without this the breaker would never trip
// and retries would never run — the resilience policy would be inert for the email channel.
class ResendTransientError extends Error {
  constructor(readonly code: string | null) {
    super("resend transient failure");
    this.name = "ResendTransientError";
  }
}

const isTransient = (statusCode: number | null): boolean =>
  statusCode === null || statusCode >= 500 || statusCode === 429;

// Real email adapter behind the NotificationSender port (the ONLY file importing the Resend SDK).
// Never logs the recipient or body, and never the provider's free-text message (it can echo the
// recipient address) — only the stable error `code`/`status`. Retrying a transient failure is safe
// because the Resend Idempotency-Key makes a re-send a provider-side no-op, not a second email.
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
      const result = await call(
        async (): Promise<{ id: string } | { rejected: { code: string | null; status: number | null } }> => {
          const { data, error } = await this.transport(
            { from: this.from, to: cmd.to, subject: emailSubjectFor(cmd.kind), text: cmd.body },
            { idempotencyKey: cmd.idempotencyKey },
          );
          if (data && !error) return { id: data.id };
          const statusCode = error?.statusCode ?? null;
          // Transient → throw so the breaker counts it and the idempotent retry fires. Deterministic
          // 4xx (validation, unverified domain, invalid recipient) → return a failure: never trip the
          // breaker or retry a request that will fail identically.
          if (isTransient(statusCode)) throw new ResendTransientError(error?.name ?? null);
          return { rejected: { code: error?.name ?? null, status: statusCode } };
        },
        { idempotent: true, retries: 2, timeoutMs: 10_000, breaker: this.breaker },
      );
      if ("rejected" in result) {
        logger.error(
          { provider: "resend", kind: cmd.kind, code: result.rejected.code, status: result.rejected.status },
          "resend.send rejected",
        );
        return err(externalService("resend", "the email provider rejected the message", true));
      }
      return ok({ externalId: result.id, channel: cmd.channel, sentAt: this.clock.now() });
    } catch (e) {
      // Transient throw that exhausted retries, a timeout, or an open breaker. Log only the code —
      // never the provider's free-text message.
      logger.error(
        { provider: "resend", kind: cmd.kind, code: e instanceof ResendTransientError ? e.code : (e instanceof Error ? e.name : "unknown") },
        "resend.send failed",
      );
      return err(externalService("resend", "the email provider is temporarily unavailable", true));
    }
  }
}
