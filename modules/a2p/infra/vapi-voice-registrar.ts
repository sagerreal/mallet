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
  /** Reading numbers back, so a duplicate can be repaired rather than assumed correct. */
  get(path: string): Promise<{ status: number; body: unknown }>;
  patch(path: string, body: unknown): Promise<{ status: number; body: unknown }>;
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
      (() => {
        const call = async (method: string, path: string, body?: unknown) => {
          const res = await fetch(`https://api.vapi.ai${path}`, {
            method,
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          });
          let parsed: unknown = null;
          try {
            parsed = await res.json();
          } catch {
            parsed = null;
          }
          return { status: res.status, body: parsed };
        };
        return {
          post: (path: string, body: unknown) => call("POST", path, body),
          get: (path: string) => call("GET", path),
          patch: (path: string, body: unknown) => call("PATCH", path, body),
        };
      })();
  }

  /**
   * Point an ALREADY-IMPORTED number at this deployment's webhook, with this deployment's secret.
   *
   * The webhook rejects any request whose `x-vapi-secret` does not match (401, before any parse) —
   * fail-closed, and correct. A number imported without that secret therefore rings and dies
   * silently. Repairing on the duplicate path means the fix rides the same call that provisioning
   * and the settings switch already make, rather than needing anyone to notice.
   */
  private async repair(phoneNumber: string): Promise<Result<void, ExternalServiceError>> {
    const listed = await this.transport.get("/phone-number");
    const rows = Array.isArray(listed.body) ? (listed.body as { id?: string; number?: string }[]) : [];
    const found = rows.find((r) => r.number === phoneNumber);
    if (!found?.id) {
      // Vapi says duplicate but will not show it to us. Nothing safe to do; the line may work.
      logger.warn({ phoneNumber }, "a2p.voice.duplicate_not_found");
      return ok(undefined);
    }

    const patched = await this.transport.patch(`/phone-number/${found.id}`, {
      server: {
        url: this.serverUrl,
        ...(this.serverSecret ? { secret: this.serverSecret } : {}),
      },
    });
    if (patched.status >= 200 && patched.status < 300) {
      logger.info({ phoneNumber }, "a2p.voice.repaired");
      return ok(undefined);
    }
    logger.error({ phoneNumber, status: patched.status }, "a2p.voice.repair_failed");
    return err(externalService("vapi", "could not connect the number to the front desk"));
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

      // ALREADY IMPORTED IS NOT ALREADY CORRECT.
      //
      // This used to return ok() here, on the reasoning that a retried provision should not report
      // a broken line. But "Vapi holds this number" says nothing about whether it points at the
      // right place with the right secret — and both live numbers were imported BY HAND in the
      // dashboard with no server secret, so every inbound call was rejected 401 by our own webhook
      // before Mallet saw it. Silent, and indistinguishable from the AI simply not answering.
      //
      // So a duplicate is repaired rather than assumed: read the number back and PATCH its server
      // config to what this deployment actually expects.
      if (res.status === 409 || describes(res.body, /already exists|already in use|duplicate/i)) {
        return this.repair(cmd.phoneNumber);
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
