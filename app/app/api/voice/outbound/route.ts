import { validateRequest } from "twilio";
import { loadConfig } from "@mallet/shared/config";
import { withTenant } from "@mallet/shared/db/tx";
import { runWithContext, enrichRequestContext, logger } from "@mallet/shared/observability";
import { asOutboundCallId } from "@mallet/shared/types";
import { DrizzleOutboundCallRepository, DrizzleOrgByCallIdReader } from "@mallet/calls";
import { getAppDeps } from "@/trpc/di";

// Twilio voice TwiML route — a plain Next route (NOT tRPC). Twilio fetches this the moment the
// AGENT answers leg A, and the TwiML it gets back tells Twilio who to bridge in as leg B.
//
// SECURITY — this is the most sensitive endpoint in the feature. Two rules make it safe:
//
//  1. The destination is NEVER taken from the request. Only our own callId travels in the URL;
//     the number is re-read from the database. Without this, anyone who could reach this route
//     could dial any number in the world using the org's caller ID (and on the org's bill).
//  2. The Twilio signature is verified BEFORE any database access, exactly as the inbound SMS
//     webhook does — an unsigned request never reaches a query.
//
// A callId is therefore only a lookup key, not a dialing primitive: guessing one still cannot
// place a call to an attacker-chosen number.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Escape the five XML entities. The numbers are E.164 from our own DB, but building XML by
// concatenation without escaping is the kind of thing that stops being true later.
const xmlEscape = (v: string): string =>
  v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

const twiml = (body: string) =>
  new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`, {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });

// Spoken to the agent and then hung up. Returning an empty <Response/> would drop the call
// silently, leaving the agent listening to nothing and wondering whether it worked.
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

  // The signed URL includes the ?callId= query string, so validate against the full request URL.
  const signature = req.headers.get("x-twilio-signature") ?? "";
  if (!validateRequest(config.TWILIO_AUTH_TOKEN, signature, req.url, params)) {
    logger.warn({ path: "voice/outbound" }, "twilio voice webhook rejected: invalid signature");
    return new Response("invalid signature", { status: 403 });
  }

  const callId = new URL(req.url).searchParams.get("callId");
  if (!callId) return new Response("missing callId", { status: 400 });

  const deps = getAppDeps();
  return runWithContext({ requestId: deps.ids.newId() }, async () => {
    try {
      // No principal exists on a provider callback, so resolve the tenant privileged and
      // minimally (OrgId only); every read below runs under RLS via withTenant.
      const orgId = await new DrizzleOrgByCallIdReader().findOrgIdByCallId(callId);
      if (!orgId) {
        logger.warn({ callId }, "twilio voice: no call found for callId");
        return sayAndHangUp("That call is no longer available.");
      }
      enrichRequestContext({ orgId });

      const call = await withTenant(orgId, async (tx) => {
        const repo = new DrizzleOutboundCallRepository(tx, orgId);
        return repo.findById(asOutboundCallId(callId));
      });

      if (!call) return sayAndHangUp("That call is no longer available.");

      // Bridge leg B. callerId is the org's business line — what the CUSTOMER's phone displays.
      return twiml(
        `<Dial callerId="${xmlEscape(call.props.fromNumber)}" answerOnBridge="true">` +
          `<Number>${xmlEscape(call.props.toNumber)}</Number>` +
          `</Dial>`,
      );
    } catch (error) {
      logger.error(
        { err: error instanceof Error ? error.message : String(error) },
        "twilio voice webhook failed",
      );
      // Speak rather than 500: a 5xx makes Twilio play its own generic error to the agent.
      return sayAndHangUp("Sorry, that call could not be connected.");
    }
  });
}
