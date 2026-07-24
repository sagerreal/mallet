import { TRPCError } from "@trpc/server";
import { withTenant } from "@mallet/shared/db/tx";
import { loadConfig } from "@mallet/shared/config";
import { router, ownerOrOffice, ownerOrOfficeNoTx } from "@/trpc/init";
import { orThrow } from "@/trpc/errors";
import { DrizzleQboConnectionRepository } from "../infra/drizzle-qbo-connection-repository";
import { GetQboStatus } from "../app/get-qbo-status";
import { DisconnectQbo } from "../app/disconnect-qbo";
import type { TenantRunner } from "../app/complete-qbo-connect";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { users } from "@mallet/shared/db/schema";
import { signOauthState } from "../domain/oauth-state";
import { HttpQboApiGateway } from "../infra/http-qbo-api-gateway";
import {
  DrizzleQboEntityLinkRepository,
  DrizzleQboSyncLogRepository,
} from "../infra/drizzle-qbo-sync-repositories";
import { EnsureFreshAccessToken } from "../app/ensure-fresh-access-token";
import { qboStatusDTO, qboBeginConnectDTO, qboSetupDTO, qboSyncLogRowDTO } from "./qbo-dto";

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

    // Everything the setup screen needs, in one round trip: QuickBooks-side facts (is time
    // tracking even on? does the company already have time in it?) plus the lists to pick from.
    // Read-only — this never writes to the shop's books.
    setup: ownerOrOffice.output(qboSetupDTO).query(async ({ ctx }) => {
      const orgId = ctx.principal.orgId;
      const connections = new DrizzleQboConnectionRepository(ctx.tx, orgId);
      const connection = await connections.get();
      const gateway = ctx.deps.qboOauthGateway;
      const box = ctx.deps.qboSecretBox;
      if (!connection || !gateway || !box) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "QuickBooks is not connected" });
      }

      const access = orThrow(
        await new EnsureFreshAccessToken(connections, gateway, box, ctx.deps.clock).exec(orgId),
      );
      const api = new HttpQboApiGateway(loadConfig().QBO_ENVIRONMENT);

      const [people, items, preflight] = await Promise.all([
        api.listPeople(access),
        api.listServiceItems(access),
        api.preflight(access),
      ]);
      const peopleList = orThrow(people);
      const itemList = orThrow(items);
      const prefs = orThrow(preflight);

      // Look back a month for time the shop is already recording in QuickBooks — pushing ours on
      // top of that would pay the same hours twice, so the UI warns rather than silently doubling.
      const since = new Date(ctx.deps.clock.now().getTime() - 30 * 24 * 60 * 60_000)
        .toISOString()
        .slice(0, 10);
      const existing = await api.countTimeActivitySince(access, since);

      const links = new DrizzleQboEntityLinkRepository(ctx.tx, orgId);
      const existingLinks = await links.listByType("employee");
      const byUser = new Map(existingLinks.map((l) => [l.malletId, l]));

      const roster = await ctx.tx
        .select({ id: users.id, name: users.name, email: users.email })
        .from(users)
        .where(eq(users.orgId, orgId));

      return {
        timeTrackingEnabled: prefs.timeTrackingEnabled,
        companyName: prefs.companyName,
        existingTimeEntries: existing.ok ? existing.value : 0,
        people: peopleList.map((p) => ({
          id: p.id,
          displayName: p.displayName,
          kind: p.kind,
          usesTimeForPaychecks: p.usesTimeForPaychecks ?? null,
        })),
        items: itemList.map((i) => ({ id: i.id, name: i.name })),
        crew: roster.map((u) => {
          const link = byUser.get(u.id);
          return {
            userId: u.id,
            name: u.name ?? u.email,
            qboId: link?.qboId ?? null,
            qboName: link?.displayName ?? null,
            qboKind: link?.qboEntityKind ?? null,
          };
        }),
        defaultItemQboId: connection.props.defaultItemQboId,
        defaultItemName: connection.props.defaultItemName,
        sendApprovedHours: connection.props.sendApprovedHours,
      };
    }),

    // Match one Mallet person to a QuickBooks employee/vendor (or clear the match).
    linkPerson: ownerOrOffice
      .input(
        z.object({
          userId: z.string().min(1),
          qboId: z.string().min(1).nullable(),
          qboName: z.string().nullable(),
          qboKind: z.enum(["Employee", "Vendor"]).nullable(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const links = new DrizzleQboEntityLinkRepository(ctx.tx, ctx.principal.orgId);
        if (input.qboId === null) {
          await links.remove("employee", input.userId);
        } else {
          await links.save({
            entityType: "employee",
            malletId: input.userId,
            qboId: input.qboId,
            qboEntityKind: input.qboKind ?? "Employee",
            displayName: input.qboName,
          });
        }
        return { ok: true };
      }),

    setDefaultItem: ownerOrOffice
      .input(z.object({ qboId: z.string().min(1), name: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleQboConnectionRepository(ctx.tx, ctx.principal.orgId);
        const connection = await repo.get();
        if (!connection) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "QuickBooks is not connected" });
        }
        await repo.save(connection.withDefaultItem(input.qboId, input.name, ctx.deps.clock.now()));
        return { ok: true };
      }),

    // The opt-in switch. Refuses to turn on without a service item, because every push would fail.
    setSendApprovedHours: ownerOrOffice
      .input(z.object({ on: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleQboConnectionRepository(ctx.tx, ctx.principal.orgId);
        const connection = await repo.get();
        if (!connection) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "QuickBooks is not connected" });
        }
        if (input.on && !connection.props.defaultItemQboId) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Choose which QuickBooks service hours are filed under first",
          });
        }
        await repo.save(connection.withSendApprovedHours(input.on, ctx.deps.clock.now()));
        return { ok: true };
      }),

    syncLog: ownerOrOffice
      .output(z.array(qboSyncLogRowDTO))
      .query(async ({ ctx }) => {
        const repo = new DrizzleQboSyncLogRepository(ctx.tx, ctx.principal.orgId);
        const rows = await repo.recent(50);
        return rows.map((r) => ({
          malletId: r.malletId,
          status: r.status,
          errorCode: r.errorCode,
          errorMessage: r.errorMessage,
          attemptedAt: r.attemptedAt,
        }));
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
