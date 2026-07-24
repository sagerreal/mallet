import { validateRequest } from "twilio";
import { loadConfig } from "@mallet/shared/config";
import { withTenant } from "@mallet/shared/db/tx";
import { runWithContext, enrichRequestContext, logger } from "@mallet/shared/observability";
import {
  AdvanceA2pRegistrationUseCase,
  DrizzleRegistrationRepository,
  DrizzleOrgBySidReader,
  LoggingA2pGateway,
  type A2pTenantRunner,
} from "@mallet/a2p";
import { getAppDeps } from "@/trpc/di";

// Twilio A2P 10DLC async status-callback webhook — a plain Next route (NOT tRPC), mirroring
// app/api/webhooks/twilio/route.ts (inbound SMS). Twilio calls this asynchronously as the
// secondary customer profile / brand / campaign move through TrustHub + TCR review (see
// twilio-a2p-gateway.ts `submitProfileOp`/`createBrandOp`/`createCampaignOp` comments).
//
// SECURITY: Twilio signs every request with HMAC-SHA1 over (authToken, fullUrl, body-params).
// Signature verification is the FIRST thing that happens — before any DB access.
//
// UNLIKE the inbound SMS webhook, this route returns 204 on every outcome once the signature is
// valid — an unknown SID, a not-found registration, or an internal failure all look identical
// from the outside. Never leak registration state via the HTTP response. This is safe because
// `AdvanceA2pRegistrationUseCase` is idempotent and re-derives the decision from Twilio's current
// state on every call (see its doc comment) — the scheduled poll (Task 12) covers any callback
// this route fails to process, so nothing is silently lost by swallowing errors here.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noContent = (): Response => new Response(null, { status: 204 });

// Twilio's exact status-callback param name for the resource SID differs per resource
// (Customer Profile / Brand / Campaign) and is unconfirmed against a live account (see the
// TODO(verify vs Twilio SDK) notes in twilio-a2p-gateway.ts). Checking every candidate keeps this
// robust to whichever field name Twilio actually sends, without guessing wrong and silently
// dropping every callback.
const SID_PARAM_CANDIDATES = [
  "CustomerProfileSid",
  "BrandSid",
  "BrandRegistrationSid",
  "CampaignSid",
  "MessagingServiceSid",
  "Sid",
];

function extractResourceSid(params: Record<string, string>): string | null {
  for (const key of SID_PARAM_CANDIDATES) {
    const value = params[key];
    if (value) return value;
  }
  return null;
}

export async function POST(req: Request): Promise<Response> {
  const config = loadConfig();

  if (!config.TWILIO_AUTH_TOKEN || !config.TWILIO_ACCOUNT_SID) {
    return new Response("twilio not configured", { status: 503 });
  }

  // Read the raw body once (stream is single-use). Twilio sends form-encoded params.
  const rawBody = await req.text();

  // The full URL Twilio signed — must match exactly what Twilio was configured to call back to.
  // TWILIO_A2P_STATUS_CALLBACK_URL is the URL passed as `statusCallback` when creating the
  // secondary customer profile (twilio-a2p-gateway.ts), so it is the correct override here (same
  // proxy-deployment rationale as TWILIO_WEBHOOK_URL on the inbound SMS webhook).
  const fullUrl = config.TWILIO_A2P_STATUS_CALLBACK_URL ?? req.url;
  const signature = req.headers.get("x-twilio-signature") ?? "";

  // Parse the URL-encoded body into a plain params map (signature covers the sorted params).
  const params: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(rawBody)) {
    params[k] = v;
  }

  // Reject immediately on invalid signature — before any DB work.
  const valid = validateRequest(config.TWILIO_AUTH_TOKEN, signature, fullUrl, params);
  if (!valid) {
    logger.warn({ path: "webhooks/twilio-a2p" }, "twilio a2p webhook rejected: invalid signature");
    return new Response("invalid signature", { status: 403 });
  }

  const sid = extractResourceSid(params);
  const status = params["Status"] ?? "unknown";

  const deps = getAppDeps();
  return runWithContext({ requestId: deps.ids.newId() }, async () => {
    try {
      if (!sid) {
        // No recognizable resource SID — nothing to map to an org. Log and return 204 (never
        // leak whether this "looked like" a valid callback).
        logger.warn({ status }, "twilio a2p webhook: no resource SID in callback; ignoring");
        return noContent();
      }

      // Resolve which org owns this SID. This runs privileged (BYPASSRLS) because the webhook has
      // no principal yet — mirrors DrizzleOrgByNumberReader on the inbound SMS webhook. It returns
      // only an OrgId, never registration row data.
      const orgReader = new DrizzleOrgBySidReader();
      const orgId = await orgReader.findOrgIdBySid(sid);

      if (!orgId) {
        // Unknown SID — log and return 204 (no retry signal, no state leaked).
        logger.warn({ sid, status }, "twilio a2p webhook: no registration found for SID; ignoring");
        return noContent();
      }

      enrichRequestContext({ orgId });
      logger.info({ sid, status, orgId }, "twilio a2p webhook: advancing registration");

      // Real gateway when Twilio A2P config is present (composition root, trpc/di.ts); else the
      // logging stub — same optional-dep + `??` fallback as a2p-router.ts's submitAndRegister.
      const gateway = deps.a2pGateway ?? new LoggingA2pGateway();

      // Each call opens its OWN tenant tx (mirrors AdvanceA2pRegistrationUseCase's internal
      // read-tx / external-call / write-tx sequence — no tx stays open across the gateway's
      // network round-trip).
      const run: A2pTenantRunner = (fn) => withTenant(orgId, (tx) => fn(new DrizzleRegistrationRepository(tx, orgId)));

      const useCase = new AdvanceA2pRegistrationUseCase(gateway, run, deps.clock);
      const result = await useCase.exec({ orgId });

      if (!result.ok) {
        logger.error({ sid, status, orgId, errKind: result.error.kind }, "twilio a2p webhook: advance failed");
      }

      // 204 regardless of outcome — see the file-level doc comment on why this never leaks state.
      return noContent();
    } catch (error) {
      logger.error(
        { sid, status, err: error instanceof Error ? error.message : String(error) },
        "twilio a2p webhook processing failed",
      );
      return noContent();
    }
  });
}
