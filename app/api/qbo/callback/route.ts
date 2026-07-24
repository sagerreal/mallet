import { NextResponse } from "next/server";
import { loadConfig } from "@mallet/shared/config";
import { logger } from "@mallet/shared/observability";
import { withTenant } from "@mallet/shared/db/tx";
import { asOrgId } from "@mallet/shared/types";
import { systemClock } from "@mallet/shared/types";
import { uuidGenerator } from "@mallet/shared/ports";
import {
  CompleteQboConnect,
  DrizzleQboConnectionRepository,
  verifyOauthState,
  type TenantRunner,
} from "@mallet/accounting-sync";
import { getAppDeps } from "@/trpc/di";

// Leg 2 of the QuickBooks OAuth flow: Intuit redirects the shop's browser back here with ?code=,
// ?realmId= and our ?state=.
//
// This request carries NO Authorization header — it is a cross-site top-level navigation, so the
// app's Bearer-token auth cannot identify the caller. The tenant therefore comes from the SIGNED
// state (see domain/oauth-state.ts): it is HMAC'd server-side, so a caller cannot choose which org
// a QuickBooks company gets attached to. That signature check IS the authorization for this route.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Land the user back on the settings page with a result they can see. Never leak the raw Intuit
// error into the URL — it can echo request contents.
const backToSettings = (base: string, outcome: "connected" | "failed" | "denied"): Response =>
  NextResponse.redirect(`${base}/settings?tab=quickbooks&qbo=${outcome}`);

export const GET = async (req: Request): Promise<Response> => {
  const config = loadConfig();
  const base = config.PUBLIC_APP_URL ?? new URL(req.url).origin;
  const url = new URL(req.url);

  // The shop pressed Cancel on Intuit's consent screen. Not an error — just go back.
  if (url.searchParams.get("error")) {
    return backToSettings(base, "denied");
  }

  const code = url.searchParams.get("code") ?? "";
  const realmId = url.searchParams.get("realmId") ?? "";
  const state = url.searchParams.get("state") ?? "";

  const deps = getAppDeps();
  const secret = config.QBO_TOKEN_ENCRYPTION_KEY;
  if (!deps.qboOauthGateway || !deps.qboSecretBox || !secret) {
    logger.error("qbo.callback.unconfigured");
    return backToSettings(base, "failed");
  }

  const claims = verifyOauthState(secret, state, systemClock.now());
  if (!claims.ok) {
    // Forged, tampered, or stale. Deliberately vague to the browser; the reason is in our logs.
    logger.warn({ reason: claims.error.message }, "qbo.callback.bad_state");
    return backToSettings(base, "failed");
  }

  const orgId = asOrgId(claims.value.orgId);
  const run: TenantRunner = (fn) =>
    withTenant(orgId, (tx) => fn(new DrizzleQboConnectionRepository(tx, orgId)));

  const result = await new CompleteQboConnect(
    run,
    deps.qboOauthGateway,
    deps.qboSecretBox,
    deps.clock ?? systemClock,
    deps.ids ?? uuidGenerator,
  ).exec({ code, realmId, userId: null }, orgId);

  if (!result.ok) {
    logger.warn({ orgId, kind: result.error.kind }, "qbo.callback.connect_failed");
    return backToSettings(base, "failed");
  }

  logger.info({ orgId, realmId }, "qbo.callback.connected");
  return backToSettings(base, "connected");
};
