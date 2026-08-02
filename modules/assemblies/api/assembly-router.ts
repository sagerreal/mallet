import { z } from "zod";
import { router, ownerOrOffice } from "@/trpc/init";
import { orThrow } from "@/trpc/errors";
import { asJobId } from "@mallet/shared/types";
import {
  MeasurementSiteQuantitiesReader,
  DrizzleMeasurementRepository,
} from "@mallet/measurements";
import { DrizzleAssemblyRepository } from "../infra/drizzle-assembly-repository";
import { ListAssembliesUseCase } from "../app/list-assemblies";
import { SaveDialUseCase } from "../app/save-dial";
import { CreateAssemblyUseCase } from "../app/create-assembly";
import { ArchiveAssemblyUseCase } from "../app/archive-assembly";
import { SeedFromCaptureUseCase } from "../app/seed-from-capture";
import { assemblyConfigSchema } from "../domain/assembly-config";
import {
  assemblyItemDTO,
  seedResultDTO,
  toAssemblyItemDTO,
  rowToItemDTO,
} from "./assembly-dto";

// Row uuids OR the "catalog:<key>" synthetic id an untouched default lists
// under — both are valid targets for dial edits / removal / seeding.
const assemblyRefInput = z
  .string()
  .min(1)
  .max(80)
  .refine((v) => /^catalog:[a-z0-9_]+$/.test(v) || z.uuid().safeParse(v).success, {
    message: "expected an assembly id or catalog:<key>",
  });

const saveDialInput = z.object({
  assemblyId: assemblyRefInput,
  dialKey: z.string().min(1).max(40),
  // Raw units (cents / bps / bare factor); the use-case + domain re-validate.
  rawValue: z.number().finite().min(0).max(100_000_000),
});

const createInput = z.object({
  id: z.uuid().optional(),
  name: z.string().min(1).max(120),
  measurementBasis: z.enum(["area", "perimeter", "line", "count"]),
  pricingMode: z.enum(["cost_plus", "unit_rate"]),
  marginBps: z.number().int().min(0).max(40_000),
  jobMinimumCents: z.number().int().min(0).max(100_000_000),
  config: assemblyConfigSchema,
  position: z.number().int().min(0).max(10_000).optional(),
});

const archiveInput = z.object({ assemblyId: assemblyRefInput });

const seedInput = z.object({
  jobId: z.uuid(),
  // Same cap as buildFromMeasurements' sourceNames filter — the names come
  // from the capture rows the composer panel lists.
  sourceName: z.string().min(1).max(80),
  assemblyId: assemblyRefInput,
});

// Layer 5: thin transport. Parse input, construct org-scoped use-cases from the
// request's tx + ports, delegate, map results. No business logic here.
export const createAssemblyRouter = () =>
  router({
    list: ownerOrOffice.output(z.array(assemblyItemDTO)).query(async ({ ctx }) => {
      const repo = new DrizzleAssemblyRepository(ctx.tx, ctx.principal.orgId);
      const items = await new ListAssembliesUseCase(repo).exec();
      return items.map(toAssemblyItemDTO);
    }),

    saveDial: ownerOrOffice
      .input(saveDialInput)
      .output(assemblyItemDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleAssemblyRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new SaveDialUseCase(repo, ctx.deps.clock, ctx.deps.ids);
        const result = await useCase.exec(
          { assemblyId: input.assemblyId, dialKey: input.dialKey, rawValue: input.rawValue },
          ctx.principal.orgId,
        );
        return rowToItemDTO(orThrow(result));
      }),

    create: ownerOrOffice
      .input(createInput)
      .output(assemblyItemDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleAssemblyRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new CreateAssemblyUseCase(repo, ctx.deps.clock, ctx.deps.ids);
        const result = await useCase.exec(
          {
            id: input.id,
            name: input.name,
            measurementBasis: input.measurementBasis,
            pricingMode: input.pricingMode,
            marginBps: input.marginBps,
            jobMinimumCents: input.jobMinimumCents,
            config: input.config,
            position: input.position,
          },
          ctx.principal.orgId,
        );
        return rowToItemDTO(orThrow(result));
      }),

    archive: ownerOrOffice
      .input(archiveInput)
      .output(z.object({ ok: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleAssemblyRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new ArchiveAssemblyUseCase(repo, ctx.deps.clock, ctx.deps.ids);
        return orThrow(await useCase.exec({ assemblyId: input.assemblyId }, ctx.principal.orgId));
      }),

    // Deterministic compute over persisted rows — a query, like
    // v1.quoting.buildFromMeasurements (its held-trace sibling runs client-side
    // on the same pure engine).
    seedFromCapture: ownerOrOffice
      .input(seedInput)
      .output(seedResultDTO)
      .query(async ({ ctx, input }) => {
        const repo = new DrizzleAssemblyRepository(ctx.tx, ctx.principal.orgId);
        const measurements = new DrizzleMeasurementRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new SeedFromCaptureUseCase(
          new MeasurementSiteQuantitiesReader(measurements),
          repo,
        );
        const built = orThrow(
          await useCase.exec({
            jobId: asJobId(input.jobId),
            sourceName: input.sourceName,
            assemblyId: input.assemblyId,
          }),
        );
        return {
          lines: built.lines.map((line) => ({ ...line })),
          totalCents: built.totalCents,
          minimum: built.minimum === null ? null : { ...built.minimum },
          skipped: built.skipped.map((component) => ({ ...component })),
          derivedWaste: built.derivedWaste === null ? null : { ...built.derivedWaste },
        };
      }),
  });
