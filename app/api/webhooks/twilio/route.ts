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
