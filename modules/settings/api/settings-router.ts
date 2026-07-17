import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { CensusGeocoder } from "@mallet/frontdesk";
import { loadConfig } from "@mallet/shared/config";
import { withTenant } from "@mallet/shared/db/tx";
import { router, ownerOrOffice, ownerOrOfficeNoTx } from "@/trpc/init";
import { orThrow } from "@/trpc/errors";
import { DrizzleSettingsRepository } from "../infra/drizzle-settings-repository";
import { OrgSettings } from "../domain/org-settings";
import { GetSettingsUseCase } from "../app/get-settings";
import { UpdateConfigUseCase } from "../app/update-config";
import { UpdateBrandUseCase } from "../app/update-brand";
import { BeginConnectOnboardingUseCase, RefreshConnectStatusUseCase } from "../app/connect-onboarding";
import { CreatePricebookUseCase, UpdatePricebookUseCase, RemovePricebookUseCase } from "../app/pricebook";
import { CreateLaborRateUseCase, UpdateLaborRateUseCase, RemoveLaborRateUseCase } from "../app/labor-rates";
import { CreateTermUseCase, UpdateTermUseCase, RemoveTermUseCase } from "../app/terms";
import { CreateSourceUseCase, RemoveSourceUseCase } from "../app/sources";
import {
  settingsDTO,
  orgSettingsDTO,
  pricebookItemDTO,
  laborRateDTO,
  jobTermDTO,
  leadSourceDTO,
  bookingCfgDTO,
  toSettingsDTO,
  toOrgSettingsDTO,
  toPricebookDTO,
  toLaborRateDTO,
  toJobTermDTO,
  toLeadSourceDTO,
  pricebookCreateInput,
  pricebookUpdateInput,
  laborRateCreateInput,
  laborRateUpdateInput,
  termCreateInput,
  termUpdateInput,
  sourceCreateInput,
  updateBrandInput,
  connectStatusDTO,
  beginOnboardingResultDTO,
} from "./settings-dto";

// Shared response for remove/archive operations.
const okDTO = z.object({ ok: z.boolean() });

// Validated patch fields — all optional so the client sends only what changed.
// Bounds match the domain aggregate's clamping logic to fail fast at the boundary.
const updateConfigInput = z.object({
  trade: z.string().min(1).max(50).optional(),
  markupBps: z.number().int().min(0).max(1_000_000).optional(),
  visitScopeMinutes: z.number().int().min(0).max(1440).optional(),
  visitRepairMinutes: z.number().int().min(0).max(1440).optional(),
  visitInstallMinutes: z.number().int().min(0).max(1440).optional(),
  techSeesPrice: z.boolean().optional(),
  techTexts: z.boolean().optional(),
  frontDesk: z.boolean().optional(),
  scopeOn: z.boolean().optional(),
  hoursWdOpen: z.number().int().min(0).max(24).optional(),
  hoursWdClose: z.number().int().min(0).max(24).optional(),
  hoursSatOpen: z.number().int().min(0).max(24).optional(),
  hoursSatClose: z.number().int().min(0).max(24).optional(),
  hoursSunOpen: z.number().int().min(0).max(24).optional(),
  hoursSunClose: z.number().int().min(0).max(24).optional(),
  areaCities: z.string().max(1000).optional(),
  areaRadiusMi: z.number().int().min(0).max(500).optional(),
  // Service origin address only — lat/lng are DERIVED server-side by the geocoder on save and
  // are NEVER accepted from the client (a client can't be trusted to supply a point). null clears
  // the origin; an empty string is treated the same by the geocode-on-save flow.
  serviceOriginAddress: z.string().max(500).nullable().optional(),
  booking: bookingCfgDTO.optional(),
});

// Layer 5: thin transport. Parse/normalize input at the boundary, construct the org-scoped
// use-case from the request's tx + ports, delegate, map the Result. No business logic lives here.
// The org is ALWAYS taken from ctx.principal.orgId, never from client input.
export const createSettingsRouter = () =>
  router({
    // Full snapshot: lazily materialises the org_settings row on first call.
    // Returns settingsDTO (snapshot + brand) so the client always has brand data available
    // after the initial load without a separate updateBrand call.
    get: ownerOrOffice
      .output(settingsDTO)
      .query(async ({ ctx }) => {
        const repo = new DrizzleSettingsRepository(ctx.tx, ctx.principal.orgId);
        const result = await new GetSettingsUseCase(repo).exec(ctx.principal.orgId);
        return toSettingsDTO(orThrow(result));
      }),

    // Patch org config scalars and/or the booking jsonb blob.
    updateConfig: ownerOrOffice
      .input(updateConfigInput)
      .output(orgSettingsDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleSettingsRepository(ctx.tx, ctx.principal.orgId);
        // Inject the Census-backed Geocoder (a port; the use-case never sees the HTTP details).
        // Constructed here at the composition seam — the settings module owns no geocoder infra.
        // A miss/failure returns null and is logged; the save still succeeds.
        const result = await new UpdateConfigUseCase(
          repo,
          ctx.deps.clock,
          new CensusGeocoder(),
        ).exec(input, ctx.principal.orgId);
        return toOrgSettingsDTO(orThrow(result));
      }),

    // Patch brand identity fields (name → orgs.name, brand_* → org_settings).
    // Returns the full settingsDTO so the client reconciles brand + config + collections
    // in one shot — same shape as get() extended with a brand object.
    // Org is always sourced from ctx.principal.orgId; the client MUST NOT pass orgId.
    updateBrand: ownerOrOffice
      .input(updateBrandInput)
      .output(settingsDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleSettingsRepository(ctx.tx, ctx.principal.orgId);
        // repo satisfies both OrgSettingsConfigPort and OrgNameWriter — inject once for both roles.
        const result = await new UpdateBrandUseCase(repo, repo, ctx.deps.clock).exec(
          {
            name: input.name,
            tagline: input.tagline,
            site: input.site,
            color: input.color,
            logoUrl: input.logoUrl,
            initials: input.initials,
          },
          ctx.principal.orgId,
        );
        orThrow(result);
        // Re-fetch the full snapshot so the response includes all four collections —
        // avoids partial responses and keeps the client store reconciliation simple.
        const snapshot = await new GetSettingsUseCase(repo).exec(ctx.principal.orgId);
        return toSettingsDTO(orThrow(snapshot));
      }),

    // --- Pricebook -------------------------------------------------------

    pricebook: router({
      create: ownerOrOffice
        .input(pricebookCreateInput)
        .output(pricebookItemDTO)
        .mutation(async ({ ctx, input }) => {
          const repo = new DrizzleSettingsRepository(ctx.tx, ctx.principal.orgId);
          const result = await new CreatePricebookUseCase(repo, ctx.deps.ids).exec(
            input,
            ctx.principal.orgId,
          );
          return toPricebookDTO(orThrow(result));
        }),

      update: ownerOrOffice
        .input(pricebookUpdateInput)
        .output(pricebookItemDTO)
        .mutation(async ({ ctx, input }) => {
          const repo = new DrizzleSettingsRepository(ctx.tx, ctx.principal.orgId);
          const result = await new UpdatePricebookUseCase(repo, ctx.deps.clock).exec(
            input,
            ctx.principal.orgId,
          );
          return toPricebookDTO(orThrow(result));
        }),

      remove: ownerOrOffice
        .input(z.object({ id: z.string().uuid() }))
        .output(okDTO)
        .mutation(async ({ ctx, input }) => {
          const repo = new DrizzleSettingsRepository(ctx.tx, ctx.principal.orgId);
          const result = await new RemovePricebookUseCase(repo, ctx.deps.clock).exec(
            input,
            ctx.principal.orgId,
          );
          return orThrow(result);
        }),
    }),

    // --- Labor rates -----------------------------------------------------

    laborRates: router({
      create: ownerOrOffice
        .input(laborRateCreateInput)
        .output(laborRateDTO)
        .mutation(async ({ ctx, input }) => {
          const repo = new DrizzleSettingsRepository(ctx.tx, ctx.principal.orgId);
          const result = await new CreateLaborRateUseCase(repo, ctx.deps.ids).exec(
            input,
            ctx.principal.orgId,
          );
          return toLaborRateDTO(orThrow(result));
        }),

      update: ownerOrOffice
        .input(laborRateUpdateInput)
        .output(laborRateDTO)
        .mutation(async ({ ctx, input }) => {
          const repo = new DrizzleSettingsRepository(ctx.tx, ctx.principal.orgId);
          const result = await new UpdateLaborRateUseCase(repo, ctx.deps.clock).exec(
            input,
            ctx.principal.orgId,
          );
          return toLaborRateDTO(orThrow(result));
        }),

      remove: ownerOrOffice
        .input(z.object({ id: z.string().uuid() }))
        .output(okDTO)
        .mutation(async ({ ctx, input }) => {
          const repo = new DrizzleSettingsRepository(ctx.tx, ctx.principal.orgId);
          const result = await new RemoveLaborRateUseCase(repo, ctx.deps.clock).exec(
            input,
            ctx.principal.orgId,
          );
          return orThrow(result);
        }),
    }),

    // --- Job terms -------------------------------------------------------

    terms: router({
      create: ownerOrOffice
        .input(termCreateInput)
        .output(jobTermDTO)
        .mutation(async ({ ctx, input }) => {
          const repo = new DrizzleSettingsRepository(ctx.tx, ctx.principal.orgId);
          const result = await new CreateTermUseCase(repo, ctx.deps.ids).exec(
            input,
            ctx.principal.orgId,
          );
          return toJobTermDTO(orThrow(result));
        }),

      update: ownerOrOffice
        .input(termUpdateInput)
        .output(jobTermDTO)
        .mutation(async ({ ctx, input }) => {
          const repo = new DrizzleSettingsRepository(ctx.tx, ctx.principal.orgId);
          const result = await new UpdateTermUseCase(repo, ctx.deps.clock).exec(
            input,
            ctx.principal.orgId,
          );
          return toJobTermDTO(orThrow(result));
        }),

      remove: ownerOrOffice
        .input(z.object({ id: z.string().uuid() }))
        .output(okDTO)
        .mutation(async ({ ctx, input }) => {
          const repo = new DrizzleSettingsRepository(ctx.tx, ctx.principal.orgId);
          const result = await new RemoveTermUseCase(repo, ctx.deps.clock).exec(
            input,
            ctx.principal.orgId,
          );
          return orThrow(result);
        }),
    }),

    // --- Lead sources ----------------------------------------------------

    sources: router({
      create: ownerOrOffice
        .input(sourceCreateInput)
        .output(leadSourceDTO)
        .mutation(async ({ ctx, input }) => {
          const repo = new DrizzleSettingsRepository(ctx.tx, ctx.principal.orgId);
          const result = await new CreateSourceUseCase(repo, ctx.deps.ids).exec(
            input,
            ctx.principal.orgId,
          );
          return toLeadSourceDTO(orThrow(result));
        }),

      remove: ownerOrOffice
        .input(z.object({ id: z.string().uuid() }))
        .output(okDTO)
        .mutation(async ({ ctx, input }) => {
          const repo = new DrizzleSettingsRepository(ctx.tx, ctx.principal.orgId);
          const result = await new RemoveSourceUseCase(repo, ctx.deps.clock).exec(
            input,
            ctx.principal.orgId,
          );
          return orThrow(result);
        }),
    }),

    // --- Payments (Stripe Connect Express onboarding — PR1) --------------
    // Org is ALWAYS ctx.principal.orgId; the connected account id is read from the org's own
    // settings row under RLS. No money moves here — this only links the shop's bank.
    //
    // beginOnboarding/refresh use ownerOrOfficeNoTx + a per-op tenant runner so each DB write commits
    // in its OWN short transaction and the external Stripe calls happen OUTSIDE any open tx — the
    // account id is durably persisted before the fallible onboarding-link step (a link failure can't
    // roll back the saved id and orphan the real Stripe account).
    payments: router({
      // Read persisted onboarding status. No Stripe call — cheap, safe to poll on page load.
      status: ownerOrOffice.output(connectStatusDTO).query(async ({ ctx }) => {
        const repo = new DrizzleSettingsRepository(ctx.tx, ctx.principal.orgId);
        const settings = await repo.getConfig(ctx.principal.orgId, OrgSettings.defaultBooking);
        const p = settings.props;
        return {
          hasAccount: p.stripeConnectedAccountId !== null,
          detailsSubmitted: p.stripeDetailsSubmitted,
          chargesEnabled: p.stripeChargesEnabled,
          payoutsEnabled: p.stripePayoutsEnabled,
        };
      }),

      // Start/resume Express onboarding; returns the Stripe-hosted url to redirect to.
      beginOnboarding: ownerOrOfficeNoTx.output(beginOnboardingResultDTO).mutation(async ({ ctx }) => {
        const base = loadConfig().PUBLIC_APP_URL;
        if (!ctx.deps.connectGateway || !base) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "payments are not configured yet" });
        }
        const orgId = ctx.principal.orgId;
        const run = <T>(fn: (repo: DrizzleSettingsRepository) => Promise<T>): Promise<T> =>
          withTenant(orgId, (tx) => fn(new DrizzleSettingsRepository(tx, orgId)));
        const result = await new BeginConnectOnboardingUseCase(
          ctx.deps.connectGateway,
          run,
          ctx.deps.clock,
        ).exec({
          orgId,
          returnUrl: `${base}/settings?tab=payments&connect=return`,
          refreshUrl: `${base}/settings?tab=payments&connect=refresh`,
        });
        return orThrow(result);
      }),

      // Pull latest status from Stripe + persist (called on the onboarding-return redirect).
      refresh: ownerOrOfficeNoTx.output(connectStatusDTO).mutation(async ({ ctx }) => {
        if (!ctx.deps.connectGateway) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "payments are not configured yet" });
        }
        const orgId = ctx.principal.orgId;
        const run = <T>(fn: (repo: DrizzleSettingsRepository) => Promise<T>): Promise<T> =>
          withTenant(orgId, (tx) => fn(new DrizzleSettingsRepository(tx, orgId)));
        const result = await new RefreshConnectStatusUseCase(
          ctx.deps.connectGateway,
          run,
          ctx.deps.clock,
        ).exec({ orgId });
        return orThrow(result);
      }),
    }),
  });
