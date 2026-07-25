import { validateRequest } from "twilio";
import { loadConfig } from "@mallet/shared/config";
import { withTenant } from "@mallet/shared/db/tx";
import { runWithContext, enrichRequestContext, logger } from "@mallet/shared/observability";
import { asOutboundCallId, isOk } from "@mallet/shared/types";
import { DrizzleOutboundCallRepository, DrizzleOrgByCallIdReader } from "@mallet/calls";
import { getAppDeps } from "@/trpc/di";

// TwiML for a BROWSER call — the softphone counterpart of /api/voice/outbound.
//
// The difference is which leg already exists. On the phone bridge we ring the caller's handset and
// this route is fetched when they answer. Here the caller is ALREADY on the line (their browser is
// the leg), so Twilio fetches this the moment the client device connects, and the only leg left to
// dial is the customer's.
//
// SECURITY — the same two rules as the bridge route, for the same reasons:
//   1. The destination is NEVER taken from the request. Only our own callId travels; the number is
//      re-read from the database. Otherwise anyone reaching this route could dial any number in
//      the world on the org's caller ID and the org's bill.
//   2. The Twilio signature is verified BEFORE any database access.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const xmlEscape = (v: string): string =>
  v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

const twiml = (body: string) =>
  new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`, {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });

// Spoken into the caller's headset and then hung up. An empty <Response/> would drop them into
// silence with no idea whether anything happened.
const sayAndHangUp = (message: string) => twiml(`<Say>${xmlEscape(message)}</Say><Hangup/>`);

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
    logger.warn({ path: "voice/browser" }, "twilio browser voice rejected: invalid signature");
    return new Response("invalid signature", { status: 403 });
  }

  // Sent by the client as a connect parameter, so it arrives in the POST body rather than the URL.
  const callId = params["callId"];
  const clientCallSid = params["CallSid"];
  if (!callId) return new Response("missing callId", { status: 400 });

  const deps = getAppDeps();
  return runWithContext({ requestId: deps.ids.newId() }, async () => {
    try {
      // No principal exists on a provider callback, so resolve the tenant privileged and minimally
      // (OrgId only); every read and write below runs under RLS via withTenant.
      const orgId = await new DrizzleOrgByCallIdReader().findOrgIdByCallId(callId);
      if (!orgId) {
        logger.warn({ callId }, "twilio browser voice: no call found for callId");
        return sayAndHangUp("That call is no longer available.");
      }
      enrichRequestContext({ orgId });

      const call = await withTenant(orgId, async (tx) => {
        const repo = new DrizzleOutboundCallRepository(tx, orgId);
        const found = await repo.findById(asOutboundCallId(callId));
        if (!found) return null;
        // Bind the row to the client leg's SID now — this is the first moment we know it, and the
        // status callback that ends the call resolves the row by exactly this value.
        const dialing = found.markDialing(clientCallSid ?? "", deps.clock.now());
        if (isOk(dialing)) await repo.save(dialing.value);
        return found;
      });

      if (!call) return sayAndHangUp("That call is no longer available.");
      if (call.props.transport !== "browser") {
        // A phone-bridge call must not be answerable by a browser: its handset leg is the one
        // that is meant to be on this line.
        logger.warn({ callId }, "twilio browser voice: call is not a browser call");
        return sayAndHangUp("That call is no longer available.");
      }

      // Dial the customer. callerId is the org's business line — what THEIR phone displays.
      // The per-leg statusCallback is what tells us the customer actually picked up: the client
      // leg has been "in-progress" since the browser connected, so it can never mean that.
      const base = (config.PUBLIC_APP_URL ?? "").replace(/\/+$/, "");
      const bridged = `${base}/api/webhooks/twilio/voice-bridge?callId=${encodeURIComponent(callId)}`;
      return twiml(
        `<Dial callerId="${xmlEscape(call.props.fromNumber)}" answerOnBridge="true">` +
          `<Number statusCallback="${xmlEscape(bridged)}" statusCallbackEvent="answered completed" statusCallbackMethod="POST">` +
          `${xmlEscape(call.props.toNumber)}` +
          `</Number>` +
          `</Dial>`,
      );
    } catch (error) {
      logger.error(
        { err: error instanceof Error ? error.message : String(error) },
        "twilio browser voice webhook failed",
      );
      // Speak rather than 500: a 5xx makes Twilio play its own generic error into the headset.
      return sayAndHangUp("Sorry, that call could not be connected.");
    }
  });
}
