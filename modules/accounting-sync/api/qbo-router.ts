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
import { DrizzleSyncLabelReader } from "../infra/drizzle-sync-label-reader";
import { GetQboSyncActivity } from "../app/get-qbo-sync-activity";
import { EnsureFreshAccessToken } from "../app/ensure-fresh-access-token";
import { qboStatusDTO, qboBeginConnectDTO, qboSetupDTO, qboSyncActivityDTO } from "./qbo-dto";

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

    // What actually happened on the last pushes. Read-only, no Intuit call — this is our own log,
    // and it must load even when the connection is dead, because a dead connection is precisely
    // what it exists to report.
    syncActivity: ownerOrOffice
      .input(z.object({ limit: z.number().int().positive().max(100).optional() }).optional())
      .output(qboSyncActivityDTO)
      .query(async ({ ctx, input }) => {
        const orgId = ctx.principal.orgId;
        const syncLog = new DrizzleQboSyncLogRepository(ctx.tx, orgId);
        const labels = new DrizzleSyncLabelReader(ctx.tx, orgId);
        const activity = await new GetQboSyncActivity(syncLog, labels).exec(input?.limit);
        // Copied out rather than returned directly: the use-case's shape is readonly, and a DTO is
        // a wire contract that must not be the domain object by another name.
        return {
          rows: activity.rows.map((r) => ({
            entityType: r.entityType,
            malletId: r.malletId,
            label: r.label,
            status: r.status,
            qboId: r.qboId,
            problem: r.problem
              ? {
                  code: r.problem.code,
                  says: r.problem.says,
                  fix: r.problem.fix,
                  retryable: r.problem.retryable,
                }
              : null,
            detail: r.detail,
            attemptedAt: r.attemptedAt,
          })),
          retryableCount: activity.retryableCount,
        };
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
        // Fall back to the company's OWN default time item when the shop hasn't chosen one — QBO
        // already answers this question, so don't make them answer it twice. Flagged as unsaved so
        // the UI commits it rather than showing a choice the server doesn't actually hold.
        defaultItemSaved: connection.props.defaultItemQboId !== null,
        defaultItemQboId: connection.props.defaultItemQboId ?? prefs.defaultItemId,
        defaultItemName:
          connection.props.defaultItemName ??
          itemList.find((i) => i.id === prefs.defaultItemId)?.name ??
          null,
        sendApprovedHours: connection.props.sendApprovedHours,
        // No fallback for this one. QuickBooks has a default TIME item to borrow, but nothing that
        // answers "which item does invoice revenue belong to" — guessing would file a shop's income
        // against an account it never chose.
        defaultInvoiceItemQboId: connection.props.defaultInvoiceItemQboId,
        defaultInvoiceItemName: connection.props.defaultInvoiceItemName,
        sendInvoices: connection.props.sendInvoices,
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

    // The invoice-line item. Deliberately separate from the hours item above: that one is labour,
    // and filing a water heater under it would be wrong.
    setDefaultInvoiceItem: ownerOrOffice
      .input(z.object({ qboId: z.string().min(1), name: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleQboConnectionRepository(ctx.tx, ctx.principal.orgId);
        const connection = await repo.get();
        if (!connection) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "QuickBooks is not connected" });
        }
        await repo.save(connection.withDefaultInvoiceItem(input.qboId, input.name, ctx.deps.clock.now()));
        return { ok: true };
      }),

    // The invoice switch, separate from hours: a shop may want its crew's time in QuickBooks
    // without handing over its invoicing, and turning one on must never turn the other on.
    setSendInvoices: ownerOrOffice
      .input(z.object({ on: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleQboConnectionRepository(ctx.tx, ctx.principal.orgId);
        const connection = await repo.get();
        if (!connection) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "QuickBooks is not connected" });
        }
        const next = connection.withSendInvoices(input.on, ctx.deps.clock.now());
        if (!next.ok) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: next.error.message });
        }
        await repo.save(next.value);
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
