import { TRPCError } from "@trpc/server";
import { withTenant } from "@mallet/shared/db/tx";
import { loadConfig } from "@mallet/shared/config";
import { router, ownerOrOffice, ownerOrOfficeNoTx } from "@/trpc/init";
import { orThrow } from "@/trpc/errors";
import { DrizzleQboConnectionRepository } from "../infra/drizzle-qbo-connection-repository";
import { GetQboStatus } from "../app/get-qbo-status";
import { DisconnectQbo } from "../app/disconnect-qbo";
import type { TenantRunner } from "../app/complete-qbo-connect";
import { signOauthState } from "../domain/oauth-state";
import { qboStatusDTO, qboBeginConnectDTO } from "./qbo-dto";

// A consent screen should not take longer than this; a stale nonce should not linger.
const STATE_TTL_MS = 10 * 60_000;

// QuickBooks Online connection management. Org is ALWAYS ctx.principal.orgId — the realm the shop
// picks on Intuit's side is stored, never accepted as an input that could target another tenant.
//
// Neither OAuth leg is here: both are browser redirects, not tRPC calls. Starting the flow is
// app/api/qbo/authorize (it must SET the CSRF cookie, so the card links straight to it rather than
// fetching a URL from here — a URL minted without its matching cookie would always fail the
// callback's CSRF check). The return leg is app/api/qbo/callback.
//
// disconnect uses ownerOrOfficeNoTx + a per-op tenant runner so the Intuit revoke call happens
// OUTSIDE any open transaction (same rule as Stripe Connect onboarding).
export const createQboRouter = () =>
  router({
    // Read persisted status. No Intuit call — cheap and safe to load with the settings page.
    status: ownerOrOffice.output(qboStatusDTO).query(async ({ ctx }) => {
      const repo = new DrizzleQboConnectionRepository(ctx.tx, ctx.principal.orgId);
      // A null gateway means QuickBooks is unconfigured on this server — GetQboStatus reports
      // configured:false rather than the page failing.
      return new GetQboStatus(repo, ctx.deps.qboOauthGateway ?? null, ctx.deps.clock).exec();
    }),

    // Start the flow: mint a signed state and hand back Intuit's consent URL for the client to
    // navigate to. Mirrors payments.beginOnboarding — the browser cannot carry our Bearer token
    // through a redirect, so the tenant identity has to travel inside the signed state instead.
    beginConnect: ownerOrOfficeNoTx.output(qboBeginConnectDTO).mutation(({ ctx }) => {
      const gateway = ctx.deps.qboOauthGateway;
      const box = ctx.deps.qboSecretBox;
      if (!gateway?.isConfigured() || !box) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "QuickBooks is not configured on this server",
        });
      }
      const secret = loadConfig().QBO_TOKEN_ENCRYPTION_KEY;
      if (!secret) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "QuickBooks is not configured on this server",
        });
      }
      const expiresAt = new Date(ctx.deps.clock.now().getTime() + STATE_TTL_MS);
      const state = signOauthState(secret, ctx.principal.orgId, expiresAt);
      return { url: gateway.authorizeUrl(state) };
    }),

    disconnect: ownerOrOfficeNoTx.mutation(async ({ ctx }) => {
      const gateway = ctx.deps.qboOauthGateway;
      const box = ctx.deps.qboSecretBox;
      if (!gateway || !box) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "QuickBooks is not configured on this server",
        });
      }
      const orgId = ctx.principal.orgId;
      const run: TenantRunner = (fn) =>
        withTenant(orgId, (tx) => fn(new DrizzleQboConnectionRepository(tx, orgId)));

      orThrow(await new DisconnectQbo(run, gateway, box, ctx.deps.clock).exec(orgId));
      return { ok: true };
    }),
  });
