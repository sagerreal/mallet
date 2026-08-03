import type { Result, ExternalServiceError } from "@mallet/shared/types";
import { ok, err, externalService } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import type { VoiceRegistrar } from "../domain/voice-registrar";

/**
 * Hands a Twilio number to Vapi so inbound calls reach the AI front desk.
 *
 * ONE WEBHOOK SERVES EVERY SHOP. The number is registered with a `server.url` and NO assistantId,
 * so Vapi asks Mallet for an assistant on each call (`assistant-request`) and
 * app/api/frontdesk/vapi resolves the org from the To-number. Baking a per-org assistant into Vapi
 * instead would mean a second copy of every shop's playbook living outside the database, drifting
 * the moment somebody edits their booking rules.
 *
 * Importing also makes Vapi rewrite the number's Twilio voice URL to its own endpoint, which is
 * what actually connects the line — so this call is the whole of "wire voice", not a step in it.
 */

/** The transport seam — swapped in tests so the import path runs without a Vapi account. */
export interface VapiHttpTransport {
  post(path: string, body: unknown): Promise<{ status: number; body: unknown }>;
}

export class VapiVoiceRegistrar implements VoiceRegistrar {
  private readonly transport: VapiHttpTransport;

  constructor(
    apiKey: string,
    private readonly serverUrl: string,
    private readonly twilioAccountSid: string,
    private readonly twilioAuthToken: string,
    private readonly serverSecret?: string,
    transport?: VapiHttpTransport,
  ) {
    this.transport =
      transport ??
      {
        async post(path, body) {
          const res = await fetch(`https://api.vapi.ai${path}`, {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          let parsed: unknown = null;
          try {
            parsed = await res.json();
          } catch {
            parsed = null;
          }
          return { status: res.status, body: parsed };
        },
      };
  }

  async register(cmd: { phoneNumber: string }): Promise<Result<void, ExternalServiceError>> {
    try {
      const res = await this.transport.post("/phone-number", {
        provider: "twilio",
        number: cmd.phoneNumber,
        twilioAccountSid: this.twilioAccountSid,
        twilioAuthToken: this.twilioAuthToken,
        // No assistantId on purpose — see the class comment.
        server: {
          url: this.serverUrl,
          ...(this.serverSecret ? { secret: this.serverSecret } : {}),
        },
      });

      if (res.status >= 200 && res.status < 300) {
        logger.info({ phoneNumber: cmd.phoneNumber }, "a2p.voice.registered");
        return ok(undefined);
      }

      // Already imported — a retried provision, not a failure. Treated as success so a retry does
      // not report a broken line that is in fact working.
      if (res.status === 409 || describes(res.body, /already exists|already in use|duplicate/i)) {
        logger.info({ phoneNumber: cmd.phoneNumber }, "a2p.voice.already_registered");
        return ok(undefined);
      }

      logger.error({ phoneNumber: cmd.phoneNumber, status: res.status }, "a2p.voice.register_failed");
      return err(externalService("vapi", "could not connect the number to the front desk"));
    } catch (error) {
      logger.error(
        { phoneNumber: cmd.phoneNumber, err: error instanceof Error ? error.message : String(error) },
        "a2p.voice.register_threw",
      );
      return err(externalService("vapi", "could not connect the number to the front desk"));
    }
  }
}

/** Vapi returns its reason in `message`, sometimes as a string and sometimes as an array. */
function describes(body: unknown, re: RegExp): boolean {
  if (!body || typeof body !== "object") return false;
  const msg = (body as { message?: unknown }).message;
  if (typeof msg === "string") return re.test(msg);
  if (Array.isArray(msg)) return msg.some((m) => typeof m === "string" && re.test(m));
  return false;
}
