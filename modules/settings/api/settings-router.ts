import { z } from "zod";
import { router, ownerOrOffice } from "@/trpc/init";
import { orThrow } from "@/trpc/errors";
import { DrizzleSettingsRepository } from "../infra/drizzle-settings-repository";
import { GetSettingsUseCase } from "../app/get-settings";
import { UpdateConfigUseCase } from "../app/update-config";
import { CreatePricebookUseCase, UpdatePricebookUseCase, RemovePricebookUseCase } from "../app/pricebook";
import { CreateLaborRateUseCase, UpdateLaborRateUseCase, RemoveLaborRateUseCase } from "../app/labor-rates";
import { CreateTermUseCase, UpdateTermUseCase, RemoveTermUseCase } from "../app/terms";
import { CreateSourceUseCase, RemoveSourceUseCase } from "../app/sources";
import {
  settingsSnapshotDTO,
  orgSettingsDTO,
  pricebookItemDTO,
  laborRateDTO,
  jobTermDTO,
  leadSourceDTO,
  bookingCfgDTO,
  toSnapshotDTO,
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
  booking: bookingCfgDTO.optional(),
});

// Layer 5: thin transport. Parse/normalize input at the boundary, construct the org-scoped
// use-case from the request's tx + ports, delegate, map the Result. No business logic lives here.
// The org is ALWAYS taken from ctx.principal.orgId, never from client input.
export const createSettingsRouter = () =>
  router({
    // Full snapshot: lazily materialises the org_settings row on first call.
    get: ownerOrOffice
      .output(settingsSnapshotDTO)
      .query(async ({ ctx }) => {
        const repo = new DrizzleSettingsRepository(ctx.tx, ctx.principal.orgId);
        const result = await new GetSettingsUseCase(repo).exec(ctx.principal.orgId);
        return toSnapshotDTO(orThrow(result));
      }),

    // Patch org config scalars and/or the booking jsonb blob.
    updateConfig: ownerOrOffice
      .input(updateConfigInput)
      .output(orgSettingsDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleSettingsRepository(ctx.tx, ctx.principal.orgId);
        const result = await new UpdateConfigUseCase(repo, ctx.deps.clock).exec(
          input,
          ctx.principal.orgId,
        );
        return toOrgSettingsDTO(orThrow(result));
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
  });
