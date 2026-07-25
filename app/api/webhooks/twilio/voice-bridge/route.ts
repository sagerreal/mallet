import { validateRequest } from "twilio";
import { loadConfig } from "@mallet/shared/config";
import { withTenant } from "@mallet/shared/db/tx";
import { runWithContext, enrichRequestContext, logger } from "@mallet/shared/observability";
import { asOutboundCallId, isOk } from "@mallet/shared/types";
import { DrizzleOutboundCallRepository, DrizzleOrgByCallIdReader, ApplyCallStatusUseCase } from "@mallet/calls";
import { getAppDeps } from "@/trpc/di";

// Status of the CUSTOMER's leg on a browser call.
//
// Why this exists separately from /api/webhooks/twilio/voice-status: that route reports the leg we
// originated, and on a browser call that leg is the caller's own browser — "in-progress" from the
// instant they press Call, before the customer's phone has even rung. Timing a call from it would
// count the ringing as talk time, which is the exact dishonesty the bar was fixed to stop.
//
// This one is attached to the <Number> inside the <Dial>, so it fires when the CUSTOMER answers
// and when their leg ends. That is the only signal that means "connected".
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ok204 = () => new Response("", { status: 204 });

export async function POST(req: Request): Promise<Response> {
  const config = loadConfig();

  if (!config.TWILIO_AUTH_TOKEN || !config.TWILIO_ACCOUNT_SID) {
    return new Response("twilio not configured", { status: 503 });
  }

  const rawBody = await req.text();
  const params: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(rawBody)) {
    params[k] = v;
  }

  // Our callId rides in the query string, so it is covered by the signature over the full URL.
  const signature = req.headers.get("x-twilio-signature") ?? "";
  if (!validateRequest(config.TWILIO_AUTH_TOKEN, signature, req.url, params)) {
    logger.warn({ path: "webhooks/twilio/voice-bridge" }, "twilio voice-bridge rejected: invalid signature");
    return new Response("invalid signature", { status: 403 });
  }

  const callId = new URL(req.url).searchParams.get("callId");
  const callStatus = params["CallStatus"];
  if (!callId || !callStatus) return new Response("missing required fields", { status: 400 });

  const rawDuration = params["CallDuration"];
  const durationSec = rawDuration === undefined ? null : Number.parseInt(rawDuration, 10);

  const deps = getAppDeps();
  return runWithContext({ requestId: deps.ids.newId() }, async () => {
    try {
      const orgId = await new DrizzleOrgByCallIdReader().findOrgIdByCallId(callId);
      if (!orgId) {
        // Unknown id — 204 so Twilio stops retrying a callback we can never match.
        logger.warn({ callId }, "twilio voice-bridge: no call for that id; ignoring");
        return ok204();
      }
      enrichRequestContext({ orgId });

      const applied = await withTenant(orgId, async (tx) => {
        const repo = new DrizzleOutboundCallRepository(tx, orgId);
        const call = await repo.findById(asOutboundCallId(callId));
        if (!call) return null;
        // Reuse the domain's provider-status mapping and terminal-is-final rule rather than
        // re-deciding here — the customer leg speaks the same Twilio vocabulary.
        const next = call.applyProviderStatus(
          callStatus,
          durationSec !== null && Number.isFinite(durationSec) ? durationSec : null,
          deps.clock.now(),
        );
        if (!isOk(next)) return next;
        await repo.save(next.value);
        return next;
      });

      if (applied && !isOk(applied)) {
        // A refusal here is OUR bug (unknown status, bad duration), not something Twilio can fix
        // by retrying — log it and ack so the provider stops resending.
        logger.error({ callId, callStatus, reason: applied.error.kind }, "voice-bridge not applied");
      }
      return ok204();
    } catch (error) {
      logger.error(
        { err: error instanceof Error ? error.message : String(error) },
        "twilio voice-bridge processing failed",
      );
      // 500 so Twilio retries — a dropped terminal callback would leave the log stuck mid-call.
      return new Response("processing error", { status: 500 });
    }
  });
}
