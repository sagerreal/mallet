import { after } from "next/server";
import { validateRequest } from "twilio";
import { loadConfig } from "@mallet/shared/config";
import { withTenant } from "@mallet/shared/db/tx";
import { runWithContext, enrichRequestContext, logger } from "@mallet/shared/observability";
import { uuidGenerator } from "@mallet/shared/ports";
import { DrizzleMessageRepository, DrizzleOrgByNumberReader, DrizzleLeadByPhoneReader, DrizzleLeadUnreadMarker } from "@mallet/messaging";
import { RecordInboundMessageUseCase } from "@mallet/messaging";
import { getAppDeps } from "@/trpc/di";

// Twilio inbound webhook — a plain Next route (NOT tRPC). Receives inbound SMS from Twilio,
// verifies the request signature, routes to the correct org by the To-number, records the
// inbound message, and returns valid TwiML (<Response/>) so Twilio considers the call complete.
//
// SECURITY: Twilio signs every request with HMAC-SHA1 over (authToken, fullUrl, body-params).
// An unverified endpoint would let anyone inject fake customer texts into the pipeline.
// Signature verification is the FIRST thing that happens — before any DB access.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// An agent turn is opus at high effort with up to 15 tool iterations — the tRPC route that hosts
// the same loop declares 300 too. `after()` work still bills against this ceiling, so without it
// the platform default would cut a staffer's reply off mid-thought. This route previously declared
// none because all it did was one INSERT.
export const maxDuration = 300;

// Return minimal valid TwiML — an empty <Response/> instructs Twilio to do nothing further
// (no auto-reply). Adding a <Message> here would auto-reply, which we don't want.
const twimlEmpty = () =>
  new Response("<Response/>", {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });

export async function POST(req: Request): Promise<Response> {
  const config = loadConfig();

  if (!config.TWILIO_AUTH_TOKEN || !config.TWILIO_ACCOUNT_SID) {
    return new Response("twilio not configured", { status: 503 });
  }

  // Read the raw body once (stream is single-use). Twilio sends form-encoded params.
  const rawBody = await req.text();

  // The full URL Twilio signed — must match exactly what is configured in the Twilio console.
  // TWILIO_WEBHOOK_URL overrides req.url for deployments behind proxies that don't set
  // X-Forwarded-* headers (causing req.url to differ from the externally-reachable URL).
  // Vercel propagates X-Forwarded-Proto/Host so req.url is correct there; leave TWILIO_WEBHOOK_URL
  // unset on Vercel. When set, it MUST EXACTLY match the URL in the Twilio console.
  const fullUrl = config.TWILIO_WEBHOOK_URL ?? req.url;
  const signature = req.headers.get("x-twilio-signature") ?? "";

  // A STALE override is indistinguishable from a forged request: both produce a signature
  // mismatch and a 403, with nothing to say which. That cost an afternoon when the app moved
  // domains and this variable kept pointing at the old one — every inbound text was silently
  // refused, and the only trace was an 11200 alert inside Twilio.
  //
  // Comparing the two ORIGINS turns that into a named cause. Logged (never thrown) because a
  // genuine proxy deployment sets this deliberately, and because the signature check below is
  // what actually decides — this only explains the outcome.
  if (config.TWILIO_WEBHOOK_URL) {
    const overrideOrigin = new URL(config.TWILIO_WEBHOOK_URL).origin;
    const requestOrigin = new URL(req.url).origin;
    if (overrideOrigin !== requestOrigin) {
      logger.warn(
        { overrideOrigin, requestOrigin },
        "TWILIO_WEBHOOK_URL does not match the URL this request arrived on — " +
          "signature validation will fail. Unset it on Vercel, or update it to this origin.",
      );
    }
  }

  // Parse the URL-encoded body into a plain params map (signature covers the sorted params).
  const params: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(rawBody)) {
    params[k] = v;
  }

  // Reject immediately on invalid signature — before any DB work.
  const valid = validateRequest(config.TWILIO_AUTH_TOKEN, signature, fullUrl, params);
  if (!valid) {
    logger.warn({ path: "webhooks/twilio" }, "twilio webhook rejected: invalid signature");
    return new Response("invalid signature", { status: 403 });
  }

  // Extract Twilio-standard fields. All are required for inbound SMS.
  const from = params["From"];
  const to = params["To"];
  const body = params["Body"];
  const messageSid = params["MessageSid"] ?? null;

  if (!from || !to || body === undefined) {
    return new Response("missing required fields", { status: 400 });
  }

  const deps = getAppDeps();
  return runWithContext({ requestId: deps.ids.newId() }, async () => {
    // ── Staff assistant branch ────────────────────────────────────────────────────────────
    // Texts to the ONE Mallet-owned assistant number are staff talking to the AI, not customers
    // talking to a shop. That number belongs to no org, so the To-number lookup below would find
    // nothing and drop the message — this branch has to come first.
    //
    // Unset MALLET_ASSISTANT_NUMBER and the branch never runs: the feature is dark, not half-on.
    if (config.MALLET_ASSISTANT_NUMBER && to === config.MALLET_ASSISTANT_NUMBER) {
      if (!config.TWILIO_ACCOUNT_SID || !config.TWILIO_AUTH_TOKEN || !deps.llmClient) {
        logger.warn({ path: "webhooks/twilio" }, "assistant text received but the assistant is not configured");
        return twimlEmpty();
      }

      const accountSid = config.TWILIO_ACCOUNT_SID;
      const authToken = config.TWILIO_AUTH_TOKEN;
      const assistantNumber = config.MALLET_ASSISTANT_NUMBER;
      const llm = deps.llmClient;

      // Answer Twilio NOW and do the work after. A turn takes minutes; Twilio gives ~15 seconds
      // and RETRIES on timeout, so awaiting here would run the staffer's instruction twice.
      after(async () => {
        try {
          // Imported HERE, not at module scope. The assistant branch is the rare path, and a
          // static import would pull the agent, its 29 tools and the privileged db client into
          // every ordinary customer text's cold start.
          const {
            handleStaffSms,
            DrizzleStaffByPhoneReader,
            DrizzleSmsSessionStore,
            makeAgentTurnRunner,
            TwilioStaffReplySender,
          } = await import("@mallet/sms-agent");

          const staffReader = new DrizzleStaffByPhoneReader();
          const staff = await staffReader.findStaffByPhone(from);
          if (!staff) {
            // Not a verified staff mobile. Deliberately silent: replying "you are not recognised"
            // to an unknown number would confirm to a stranger that this number is a live agent
            // endpoint, and would text back at whoever a spoofer chose as the sender.
            logger.warn({ path: "webhooks/twilio" }, "assistant text from an unrecognised number; ignored");
            return;
          }

          await handleStaffSms(
            {
              staffReader: { findStaffByPhone: async () => staff },
              sessions: new DrizzleSmsSessionStore(staff.orgId, deps.ids.newId),
              runTurn: makeAgentTurnRunner({
                llm,
                clock: deps.clock,
                ids: deps.ids,
                notificationSender: deps.notificationSender,
                paymentLinkGateway: deps.paymentLinkGateway,
              }),
              reply: new TwilioStaffReplySender({
                accountSid,
                authToken,
                assistantNumber,
                messagingServiceSid: config.MALLET_ASSISTANT_MESSAGING_SERVICE_SID,
                clock: deps.clock,
              }),
            },
            { fromPhone: from, body },
          );
        } catch (error) {
          // after() runs past the response, so a throw here reaches no one. Log loudly — this is
          // the only trace that a staffer asked something and got silence.
          logger.error(
            { err: error instanceof Error ? error.message : String(error) },
            "staff assistant turn failed",
          );
        }
      });

      return twimlEmpty();
    }

    try {
      // Resolve which org owns the To-number. This runs privileged (owner role, BYPASSRLS)
      // because the webhook has no principal yet. It returns only an OrgId — minimal data.
      const orgReader = new DrizzleOrgByNumberReader();
      const orgId = await orgReader.findOrgIdByTwilioNumber(to);

      if (!orgId) {
        // Unknown number — log and return 200 so Twilio doesn't retry endlessly.
        logger.warn({ to }, "twilio inbound: no org found for To-number; ignoring");
        return twimlEmpty();
      }

      enrichRequestContext({ orgId });

      // All further work is org-scoped — RLS enforced via withTenant.
      await withTenant(orgId, async (tx) => {
        const repo = new DrizzleMessageRepository(tx, orgId);
        const leadReader = new DrizzleLeadByPhoneReader(tx, orgId);
        const unreadMarker = new DrizzleLeadUnreadMarker(tx, orgId);
        const useCase = new RecordInboundMessageUseCase(repo, leadReader, uuidGenerator, unreadMarker);
        await useCase.exec({
          orgId,
          fromPhone: from,
          toPhone: to,
          body,
          providerSid: messageSid,
        });
      });

      return twimlEmpty();
    } catch (error) {
      logger.error(
        { err: error instanceof Error ? error.message : String(error) },
        "twilio webhook processing failed",
      );
      // Return 500 so Twilio retries. Do not return 200 on an error — that would silently drop
      // the message and Twilio would not retry.
      return new Response("processing error", { status: 500 });
    }
  });
}
