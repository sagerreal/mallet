import { NextResponse } from "next/server";
import { loadConfig } from "@mallet/shared/config";
import { logger } from "@mallet/shared/observability";
import { withTenant } from "@mallet/shared/db/tx";
import { asOrgId, systemClock } from "@mallet/shared/types";
import { createSecretBox } from "@mallet/platform/crypto/secret-box";
import {
  CompleteSquareConnect,
  DrizzleSquareConnectionRepository,
  HttpSquareOauthGateway,
  verifySquareOauthState,
  type TenantRunner,
} from "@mallet/payments";

// Leg 2 of the Square OAuth flow: Square redirects the shop's browser back here with ?code= and
// our ?state=.
//
// This request carries NO Authorization header — it is a cross-site top-level navigation, so the
// app's Bearer-token auth cannot identify the caller. The tenant comes from the SIGNED state,
// HMAC'd server-side, so a caller cannot choose which org a Square merchant gets attached to.
// That signature check IS the authorization for this route, and it matters more here than for
// QuickBooks: attaching an attacker's merchant to a victim's org would route that shop's card
// revenue to the attacker.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Land the user back on settings with a result they can see. The raw Square error is NEVER put in
// the URL — it can echo request contents back.
const back = (base: string, outcome: "connected" | "failed" | "denied"): Response =>
  NextResponse.redirect(`${base}/settings?tab=integrations&square=${outcome}#square`);

export const GET = async (req: Request): Promise<Response> => {
  const config = loadConfig();
  const base = config.PUBLIC_APP_URL ?? new URL(req.url).origin;
  const url = new URL(req.url);

  // The shop pressed Deny on Square's consent screen. Not an error — just go back.
  if (url.searchParams.get("error")) return back(base, "denied");

  const code = url.searchParams.get("code") ?? "";
  const state = url.searchParams.get("state") ?? "";

  const secret = config.SQUARE_TOKEN_ENCRYPTION_KEY;
  if (!config.SQUARE_APPLICATION_ID || !config.SQUARE_APPLICATION_SECRET || !secret) {
    logger.error("square.callback.unconfigured");
    return back(base, "failed");
  }

  const claims = verifySquareOauthState(secret, state, systemClock.now());
  if (!claims.ok) {
    // Forged, tampered, or stale. Deliberately vague to the browser; the reason is in our logs.
    logger.warn({ reason: claims.error.message }, "square.callback.bad_state");
    return back(base, "failed");
  }

  const box = createSecretBox(secret);
  if (!box.ok) {
    logger.error("square.callback.bad_encryption_key");
    return back(base, "failed");
  }

  const orgId = asOrgId(claims.value.orgId);
  const run: TenantRunner = (fn) =>
    withTenant(orgId, (tx) => fn(new DrizzleSquareConnectionRepository(tx, orgId)));

  const gateway = new HttpSquareOauthGateway({
    applicationId: config.SQUARE_APPLICATION_ID,
    applicationSecret: config.SQUARE_APPLICATION_SECRET,
    redirectUri: config.SQUARE_REDIRECT_URI,
    environment: config.SQUARE_ENVIRONMENT,
  });

  // userId is null: the callback has no session to read it from. The org is what matters, and it
  // came from the signed state.
  const result = await new CompleteSquareConnect(run, gateway, box.value).exec({ code, userId: null }, orgId);

  if (!result.ok) {
    logger.warn({ orgId, reason: result.error.message }, "square.callback.failed");
    return back(base, "failed");
  }
  return back(base, "connected");
};
