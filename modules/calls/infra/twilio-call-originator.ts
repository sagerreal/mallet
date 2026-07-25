import twilio from "twilio";
import type { Result, ExternalServiceError } from "@mallet/shared/types";
import { ok, err, externalService } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import { call, CircuitBreaker } from "@mallet/platform/resilience";
import type { CallOriginator, OriginateCallCmd, CallOriginationReceipt } from "../domain/call-originator";

// The one bit of the Twilio Voice SDK we call — extracted as a seam so tests inject a fake and
// exercise the classification/breaker logic without a live account. calls.create THROWS on error;
// a Twilio RestException carries `.status` (HTTP) and `.code` (numeric Twilio code).
export type CallTransport = (params: {
  to: string;
  from: string;
  url: string;
  statusCallback: string;
  statusCallbackEvent: string[];
  statusCallbackMethod: string;
}) => Promise<{ sid: string }>;

const errStatus = (e: unknown): number | undefined =>
  typeof (e as { status?: unknown }).status === "number" ? (e as { status: number }).status : undefined;
const errCode = (e: unknown): number | null =>
  typeof (e as { code?: unknown }).code === "number" ? (e as { code: number }).code : null;

// Real outbound-voice adapter behind the CallOriginator port. Places leg A only: Twilio rings the
// agent's mobile, and when they answer it fetches TwiML from `voiceUrl` to learn who to bridge.
//
// SECURITY: only OUR call id travels in the fetch URL — never the customer's number. The TwiML
// route re-reads the destination from the database under the request signature, so this URL is
// not a dialing primitive an attacker could point anywhere.
//
// calls.create is NOT idempotent (no per-request key), so it is NOT retried — a retry would ring
// the agent twice. Deterministic 4xx rejections (unverified/invalid number, geo-permission) are
// returned as failures WITHOUT tripping the breaker; only 5xx / timeout / network reach it.
// Never logs either number or the provider's free-text message — only numeric discriminators.
export class TwilioCallOriginator implements CallOriginator {
  private readonly transport: CallTransport;
  private readonly breaker = new CircuitBreaker("twilio-voice", { failureThreshold: 5, resetMs: 30_000 });

  constructor(
    accountSid: string,
    authToken: string,
    private readonly voiceUrl: string,
    private readonly statusCallbackUrl: string,
    transport?: CallTransport,
  ) {
    // timeout: the SDK aborts its OWN request at the deadline (it ignores the resilience
    // AbortSignal), so a timed-out request is cut off rather than orphaned and dialed anyway.
    const client = twilio(accountSid, authToken, { timeout: 10_000 });
    this.transport = transport ?? ((params) => client.calls.create(params));
  }

  async originate(cmd: OriginateCallCmd): Promise<Result<CallOriginationReceipt, ExternalServiceError>> {
    const url = `${this.voiceUrl}?callId=${encodeURIComponent(cmd.callId)}`;
    try {
      const result = await call(
        async (): Promise<{ sid: string } | { rejected: { code: number | null; status: number } }> => {
          try {
            const created = await this.transport({
              to: cmd.agentNumber,
              from: cmd.fromNumber,
              url,
              statusCallback: this.statusCallbackUrl,
              statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
              statusCallbackMethod: "POST",
            });
            return { sid: created.sid };
          } catch (e) {
            const status = errStatus(e);
            if (status !== undefined && status < 500) return { rejected: { code: errCode(e), status } };
            throw e;
          }
        },
        { idempotent: false, timeoutMs: 10_000, breaker: this.breaker },
      );

      if ("rejected" in result) {
        logger.error(
          { provider: "twilio", code: result.rejected.code, status: result.rejected.status },
          "twilio.calls.create rejected",
        );
        return err(externalService("twilio", "the voice provider rejected the call", false));
      }
      return ok({ providerCallSid: result.sid });
    } catch (e) {
      logger.error(
        { provider: "twilio", code: errCode(e), status: errStatus(e) },
        "twilio.calls.create failed",
      );
      return err(externalService("twilio", "the voice provider is temporarily unavailable", true));
    }
  }
}
