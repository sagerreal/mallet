import { z } from "zod";
import { router, ownerOrOffice } from "@/trpc/init";
import { orThrow } from "@/trpc/errors";
import { loadConfig } from "@mallet/shared/config";
import { withTenant } from "@mallet/shared/db/tx";
import { systemClock } from "@mallet/shared/types";
import { createSecretBox } from "@mallet/platform/crypto/secret-box";
import { TRPCError } from "@trpc/server";
import { DrizzleSettingsRepository, OrgSettings } from "@mallet/settings";
import { HttpSquareOauthGateway } from "../infra/http-square-oauth-gateway";
import { DrizzleSquareConnectionRepository } from "../infra/drizzle-square-connection-repository";
import { StartSquareConnect, DisconnectSquare, type TenantRunner } from "../app/connect-square";

const squareStatusDTO = z.object({
  /** False when the SERVER has no Square credentials — the UI says so instead of offering a
   *  button that cannot work. */
  configured: z.boolean(),
  connected: z.boolean(),
  merchantId: z.string().nullable(),
  locationId: z.string().nullable(),
});

const buildGateway = () => {
  const c = loadConfig();
  return new HttpSquareOauthGateway({
    applicationId: c.SQUARE_APPLICATION_ID,
    applicationSecret: c.SQUARE_APPLICATION_SECRET,
    redirectUri: c.SQUARE_REDIRECT_URI,
    environment: c.SQUARE_ENVIRONMENT,
  });
};

// ownerOrOffice throughout: connecting a payment processor decides where the shop's money lands.
// That is an owner's decision, never a technician's.
export const createPaymentsRouter = () =>
  router({
    /** Which processor this shop's invoices go through. */
    provider: router({
      get: ownerOrOffice
        .output(z.object({ provider: z.enum(["stripe", "square"]) }))
        .query(async ({ ctx }) => {
          const settings = await new DrizzleSettingsRepository(ctx.tx, ctx.principal.orgId).getConfig(
            ctx.principal.orgId,
            OrgSettings.defaultBooking,
          );
          return { provider: settings.props.paymentProvider };
        }),

      set: ownerOrOffice
        .input(z.object({ provider: z.enum(["stripe", "square"]) }))
        .output(z.object({ provider: z.enum(["stripe", "square"]) }))
        .mutation(async ({ ctx, input }) => {
          const repo = new DrizzleSettingsRepository(ctx.tx, ctx.principal.orgId);
          const settings = await repo.getConfig(ctx.principal.orgId, OrgSettings.defaultBooking);

          // Refuse to point invoicing at a processor that is not connected. Allowing it would
          // produce invoices with no way to pay them, discovered by a customer rather than by the
          // shop — and the shop would have no idea why nobody is paying.
          if (input.provider === "square") {
            const live = await new DrizzleSquareConnectionRepository(ctx.tx, ctx.principal.orgId).findLive();
            if (!live) {
              throw new TRPCError({
                code: "PRECONDITION_FAILED",
                message: "Connect Square first — there is nowhere to send payments yet",
              });
            }
          }

          const next = orThrow(settings.patchPaymentProvider(input.provider, (ctx.deps.clock ?? systemClock).now()));
          await repo.saveConfig(next);
          return { provider: input.provider };
        }),
    }),

    square: router({
      status: ownerOrOffice.output(squareStatusDTO).query(async ({ ctx }) => {
        const gateway = buildGateway();
        const repo = new DrizzleSquareConnectionRepository(ctx.tx, ctx.principal.orgId);
        const live = await repo.findLive();
        return {
          configured: gateway.isConfigured(),
          connected: live !== null,
          merchantId: live?.merchantId ?? null,
          locationId: live?.locationId ?? null,
        };
      }),

      /** Leg 1 — returns the Square consent URL for the browser to navigate to. */
      connectUrl: ownerOrOffice.output(z.object({ url: z.string() })).mutation(({ ctx }) => {
        const useCase = new StartSquareConnect(
          buildGateway(),
          loadConfig().SQUARE_TOKEN_ENCRYPTION_KEY,
          ctx.deps.clock ?? systemClock,
        );
        return orThrow(useCase.exec(ctx.principal.orgId));
      }),

      disconnect: ownerOrOffice.output(z.object({ ok: z.literal(true) })).mutation(async ({ ctx }) => {
        const secret = loadConfig().SQUARE_TOKEN_ENCRYPTION_KEY;
        const box = secret ? createSecretBox(secret) : null;
        if (!box || !box.ok) {
          // Without the key we cannot open the stored token to revoke it. Rather than half-
          // disconnect, refuse and say why — the row stays, and the shop is still connected.
          throw new Error("Square is not configured on this server");
        }
        const orgId = ctx.principal.orgId;
        const run: TenantRunner = (fn) =>
          withTenant(orgId, (tx) => fn(new DrizzleSquareConnectionRepository(tx, orgId)));
        return orThrow(await new DisconnectSquare(run, buildGateway(), box.value).exec(orgId));
      }),
    }),
  });
