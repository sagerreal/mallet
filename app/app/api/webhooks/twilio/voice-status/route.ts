import { validateRequest } from "twilio";
import { loadConfig } from "@mallet/shared/config";
import { withTenant } from "@mallet/shared/db/tx";
import { runWithContext, enrichRequestContext, logger } from "@mallet/shared/observability";
import { isOk } from "@mallet/shared/types";
import {
  DrizzleOutboundCallRepository,
  DrizzleOrgByCallSidReader,
  ApplyCallStatusUseCase,
} from "@mallet/calls";
import { getAppDeps } from "@/trpc/di";

// Twilio voice status callback — a plain Next route (NOT tRPC). Twilio POSTs here as the agent
// leg progresses (initiated → ringing → answered → completed), which is how the call log learns
// that a call connected, how long it ran, and how it ended.
//
// SECURITY: signature verification is the FIRST thing that happens — before any DB access.
// An unverified endpoint would let anyone rewrite call records.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ok200 = () => new Response("", { status: 204 });

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

  const signature = req.headers.get("x-twilio-signature") ?? "";
  if (!validateRequest(config.TWILIO_AUTH_TOKEN, signature, req.url, params)) {
    logger.warn({ path: "webhooks/twilio/voice-status" }, "twilio voice-status rejected: invalid signature");
    return new Response("invalid signature", { status: 403 });
  }

  const callSid = params["CallSid"];
  const callStatus = params["CallStatus"];
  if (!callSid || !callStatus) {
    return new Response("missing required fields", { status: 400 });
  }
  // CallDuration is only present on the terminal callback, and arrives as a string.
  const rawDuration = params["CallDuration"];
  const durationSec = rawDuration === undefined ? null : Number.parseInt(rawDuration, 10);

  const deps = getAppDeps();
  return runWithContext({ requestId: deps.ids.newId() }, async () => {
    try {
      const orgId = await new DrizzleOrgByCallSidReader().findOrgIdByProviderCallSid(callSid);
      if (!orgId) {
        // Unknown SID — 204 so Twilio stops retrying a callback we can never match.
        logger.warn({ callSid }, "twilio voice-status: no outbound call for that SID; ignoring");
        return ok200();
      }
      enrichRequestContext({ orgId });

      const result = await withTenant(orgId, async (tx) => {
        const repo = new DrizzleOutboundCallRepository(tx, orgId);
        const useCase = new ApplyCallStatusUseCase(repo, deps.clock);
        return useCase.exec({
          providerCallSid: callSid,
          providerStatus: callStatus,
          durationSec: durationSec !== null && Number.isFinite(durationSec) ? durationSec : null,
        });
      });

      if (!isOk(result)) {
        // A refusal here is OUR bug (unknown status, bad duration), not something Twilio can
        // fix by retrying — log it and ack so the provider stops resending.
        logger.error({ callSid, callStatus, reason: result.error.kind }, "voice-status not applied");
      }
      return ok200();
    } catch (error) {
      logger.error(
        { err: error instanceof Error ? error.message : String(error) },
        "twilio voice-status processing failed",
      );
      // 500 so Twilio retries — a dropped terminal callback would leave the log stuck mid-call.
      return new Response("processing error", { status: 500 });
    }
  });
}
