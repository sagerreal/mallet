import { validateRequest } from "twilio";
import { loadConfig } from "@mallet/shared/config";
import { withTenant } from "@mallet/shared/db/tx";
import { runWithContext, enrichRequestContext, logger } from "@mallet/shared/observability";
import {
  DrizzleMessageRepository,
  DrizzleOrgByMessageSidReader,
  deliveryStatusOf,
} from "@mallet/messaging";
import { getAppDeps } from "@/trpc/di";

/**
 * Twilio message status callback — a plain Next route (NOT tRPC).
 *
 * Twilio POSTs here as an outbound text progresses (queued → sent → delivered, or → undelivered /
 * failed with a carrier error code). Without it a message was written "sent" at creation and never
 * touched again, so one the carrier silently dropped looked exactly like one that arrived — the
 * commonest cause being error 30034, a number not registered for A2P 10DLC, where the send
 * SUCCEEDS at Twilio and the text simply never lands.
 *
 * SECURITY: signature verification is the FIRST thing that happens, before any DB access. An
 * unverified endpoint would let anyone rewrite delivery records — marking a text that never
 * arrived as delivered, which is worse than having no status at all.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 204 for anything we cannot or should not act on, so Twilio stops retrying a callback that will
// never succeed. A non-2xx here just produces retries of the same dead request.
const ack = () => new Response("", { status: 204 });

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
    logger.warn({ path: "webhooks/twilio/message-status" }, "twilio message-status rejected: invalid signature");
    return new Response("invalid signature", { status: 403 });
  }

  const messageSid = params["MessageSid"] ?? params["SmsSid"];
  const messageStatus = params["MessageStatus"] ?? params["SmsStatus"];
  if (!messageSid || !messageStatus) {
    return new Response("missing required fields", { status: 400 });
  }

  const status = deliveryStatusOf(messageStatus);
  if (status === null) {
    // A status Twilio added since we last looked. Acknowledged rather than retried — guessing at
    // its meaning could mark an undelivered message as delivered.
    logger.warn({ messageStatus }, "twilio message-status: unrecognised status; ignoring");
    return ack();
  }

  // Present only on a failure. Kept as text: it is an identifier, never arithmetic.
  const errorCode = params["ErrorCode"] ?? null;

  const deps = getAppDeps();
  return runWithContext({ requestId: deps.ids.newId() }, async () => {
    try {
      const orgId = await new DrizzleOrgByMessageSidReader().findOrgIdByProviderSid(messageSid);
      if (!orgId) {
        // Unknown SID — a message sent before this route existed, or from another account.
        logger.warn({ messageSid }, "twilio message-status: no message for that SID; ignoring");
        return ack();
      }
      enrichRequestContext({ orgId });

      const applied = await withTenant(orgId, (tx) =>
        new DrizzleMessageRepository(tx, orgId).applyProviderStatus({
          providerSid: messageSid,
          status,
          errorCode,
          at: deps.clock.now(),
        }),
      );

      // Not applied means a stale/out-of-order callback the repository declined — ordinary, since
      // Twilio guarantees no ordering. Logged at debug volume rather than as a fault.
      logger.info({ messageSid, status, errorCode, applied }, "twilio message-status applied");
      return ack();
    } catch (error) {
      // A real failure on our side. 500 so Twilio RETRIES — losing a delivery status silently is
      // the exact problem this route exists to solve.
      logger.error(
        { messageSid, err: error instanceof Error ? error.message : String(error) },
        "twilio message-status failed",
      );
      return new Response("error", { status: 500 });
    }
  });
}
