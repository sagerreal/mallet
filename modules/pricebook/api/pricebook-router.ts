import { z } from "zod";
import { router, ownerOrOffice } from "@/trpc/init";
import { orThrow } from "@/trpc/errors";
import { asServiceId, asMaterialId, toPage } from "@mallet/shared/types";
import {
  PLUMBING_SEED_CATEGORIES,
  PLUMBING_SEED_SERVICES,
} from "@/app/(office)/settings/pricebook-seed";
import { DrizzleServiceRepository } from "../infra/drizzle-service-repository";
import { DrizzleCategoryRepository } from "../infra/drizzle-category-repository";
import { DrizzleMaterialRepository } from "../infra/drizzle-material-repository";
import { DrizzleServiceMaterialRepository } from "../infra/drizzle-service-material-repository";
import { CreateServiceUseCase } from "../app/create-service";
import { UpdateServiceUseCase } from "../app/update-service";
import { ArchiveServiceUseCase } from "../app/archive-service";
import { ListServicesUseCase } from "../app/list-services";
import { CreateCategoryUseCase } from "../app/create-category";
import { ListCategoriesUseCase } from "../app/list-categories";
import { SeedPricebookUseCase } from "../app/seed-pricebook";
import { CreateMaterialUseCase } from "../app/create-material";
import { UpdateMaterialUseCase } from "../app/update-material";
import { ArchiveMaterialUseCase } from "../app/archive-material";
import { ListMaterialsUseCase } from "../app/list-materials";
import { AttachMaterialUseCase } from "../app/attach-material";
import { DetachMaterialUseCase } from "../app/detach-material";
import { ListServiceMaterialsUseCase } from "../app/list-service-materials";
import {
  serviceDTO,
  categoryDTO,
  paginatedServiceDTO,
  toServiceDTO,
  toCategoryDTO,
  seedPricebookDTO,
  materialDTO,
  paginatedMaterialDTO,
  serviceMaterialDTO,
  toMaterialDTO,
  toServiceMaterialDTO,
} from "./pricebook-dto";

const serviceListInput = z.object({
  limit: z.number().int().positive().max(500).optional(),
  cursor: z.string().nullish(),
  search: z.string().max(200).optional(),
  categoryId: z.string().uuid().optional(),
});

const serviceCreateInput = z.object({
  // Client may author the id for optimistic UI (mirrors createCompany/createTask pattern).
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(500),
  categoryId: z.string().uuid().nullable().optional(),
  code: z.string().max(100).nullable().optional(),
  description: z.string().max(10_000).nullable().optional(),
  unitPriceCents: z.number().int().nonnegative(),
  costCents: z.number().int().nonnegative(),
  laborHours: z.number().nonnegative().nullable().optional(),
  taxable: z.boolean().optional(),
  warrantyText: z.string().max(2000).nullable().optional(),
  imageUrl: z.string().max(2048).nullable().optional(),
  isAddon: z.boolean().optional(),
  active: z.boolean().optional(),
  position: z.number().int().optional(),
});

const serviceUpdateInput = z.object({
  serviceId: z.string().uuid(),
  name: z.string().min(1).max(500).optional(),
  categoryId: z.string().uuid().nullable().optional(),
  code: z.string().max(100).nullable().optional(),
  description: z.string().max(10_000).nullable().optional(),
  unitPriceCents: z.number().int().nonnegative().optional(),
  costCents: z.number().int().nonnegative().optional(),
  laborHours: z.number().nonnegative().nullable().optional(),
  taxable: z.boolean().optional(),
  warrantyText: z.string().max(2000).nullable().optional(),
  imageUrl: z.string().max(2048).nullable().optional(),
  isAddon: z.boolean().optional(),
  active: z.boolean().optional(),
  position: z.number().int().optional(),
});

const serviceArchiveInput = z.object({
  serviceId: z.string().uuid(),
});

const categoryCreateInput = z.object({
  // Client may author the id for optimistic UI (mirrors createCompany/createTask pattern).
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(500),
  parentId: z.string().uuid().nullable().optional(),
  sortOrder: z.number().int().optional(),
});

const materialListInput = z.object({
  limit: z.number().int().positive().max(500).optional(),
  cursor: z.string().nullish(),
  search: z.string().max(200).optional(),
  categoryId: z.string().uuid().optional(),
});

const materialCreateInput = z.object({
  // Client may author the id for optimistic UI (mirrors createCompany/createTask pattern).
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(500),
  categoryId: z.string().uuid().nullable().optional(),
  code: z.string().max(100).nullable().optional(),
  description: z.string().max(10_000).nullable().optional(),
  unitCostCents: z.number().int().nonnegative(),
  unitOfMeasure: z.string().max(50).optional(),
  markupBps: z.number().int().nonnegative().nullable().optional(),
  taxable: z.boolean().optional(),
  vendor: z.string().max(500).nullable().optional(),
  active: z.boolean().optional(),
  position: z.number().int().optional(),
});

const materialUpdateInput = z.object({
  materialId: z.string().uuid(),
  name: z.string().min(1).max(500).optional(),
  categoryId: z.string().uuid().nullable().optional(),
  code: z.string().max(100).nullable().optional(),
  description: z.string().max(10_000).nullable().optional(),
  unitCostCents: z.number().int().nonnegative().optional(),
  unitOfMeasure: z.string().max(50).optional(),
  markupBps: z.number().int().nonnegative().nullable().optional(),
  taxable: z.boolean().optional(),
  vendor: z.string().max(500).nullable().optional(),
  active: z.boolean().optional(),
  position: z.number().int().optional(),
});

const materialArchiveInput = z.object({
  materialId: z.string().uuid(),
});

const serviceMaterialListInput = z.object({
  serviceId: z.string().uuid(),
});

const serviceMaterialAttachInput = z.object({
  serviceId: z.string().uuid(),
  materialId: z.string().uuid(),
  quantity: z.number().positive(),
});

const serviceMaterialDetachInput = z.object({
  serviceId: z.string().uuid(),
  materialId: z.string().uuid(),
});

// Layer 5: thin transport. Parse/normalize input, construct the org-scoped use-case from the
// request's tx + ports, delegate, map the result. No business logic lives here.
export const createPricebookRouter = () =>
  router({
    service: router({
      list: ownerOrOffice
        .input(serviceListInput)
        .output(paginatedServiceDTO)
        .query(async ({ ctx, input }) => {
          const repo = new DrizzleServiceRepository(ctx.tx, ctx.principal.orgId);
          const useCase = new ListServicesUseCase(repo);
          const page = await useCase.exec({
            page: toPage({ limit: input.limit, cursor: input.cursor ?? null }),
            search: input.search,
            categoryId: input.categoryId,
          });
          return { items: page.items.map(toServiceDTO), nextCursor: page.nextCursor };
        }),

      create: ownerOrOffice
        .input(serviceCreateInput)
        .output(serviceDTO)
        .mutation(async ({ ctx, input }) => {
          const repo = new DrizzleServiceRepository(ctx.tx, ctx.principal.orgId);
          const useCase = new CreateServiceUseCase(repo, ctx.deps.clock, ctx.deps.ids);
          const result = await useCase.exec(
            {
              id: input.id,
              name: input.name,
              categoryId: input.categoryId ?? null,
              code: input.code ?? null,
              description: input.description ?? null,
              unitPriceCents: input.unitPriceCents,
              costCents: input.costCents,
              laborHours: input.laborHours ?? null,
              taxable: input.taxable ?? false,
              warrantyText: input.warrantyText ?? null,
              imageUrl: input.imageUrl ?? null,
              isAddon: input.isAddon ?? false,
              active: input.active ?? true,
              position: input.position ?? 0,
            },
            ctx.principal.orgId,
          );
          return toServiceDTO(orThrow(result));
        }),

      update: ownerOrOffice
        .input(serviceUpdateInput)
        .output(serviceDTO)
        .mutation(async ({ ctx, input }) => {
          const repo = new DrizzleServiceRepository(ctx.tx, ctx.principal.orgId);
          const useCase = new UpdateServiceUseCase(repo, ctx.deps.clock);
          const result = await useCase.exec(
            {
              serviceId: asServiceId(input.serviceId),
              name: input.name,
              categoryId: input.categoryId,
              code: input.code,
              description: input.description,
              unitPriceCents: input.unitPriceCents,
              costCents: input.costCents,
              laborHours: input.laborHours,
              taxable: input.taxable,
              warrantyText: input.warrantyText,
              imageUrl: input.imageUrl,
              isAddon: input.isAddon,
              active: input.active,
              position: input.position,
            },
            ctx.principal.orgId,
          );
          return toServiceDTO(orThrow(result));
        }),

      archive: ownerOrOffice
        .input(serviceArchiveInput)
        .output(z.object({ ok: z.boolean() }))
        .mutation(async ({ ctx, input }) => {
          const repo = new DrizzleServiceRepository(ctx.tx, ctx.principal.orgId);
          const useCase = new ArchiveServiceUseCase(repo, ctx.deps.clock);
          const result = await useCase.exec(
            { serviceId: asServiceId(input.serviceId) },
            ctx.principal.orgId,
          );
          return orThrow(result);
        }),
    }),

    category: router({
      list: ownerOrOffice
        .output(z.array(categoryDTO))
        .query(async ({ ctx }) => {
          const repo = new DrizzleCategoryRepository(ctx.tx, ctx.principal.orgId);
          const useCase = new ListCategoriesUseCase(repo);
          const categories = await useCase.exec();
          return categories.map(toCategoryDTO);
        }),

      create: ownerOrOffice
        .input(categoryCreateInput)
        .output(categoryDTO)
        .mutation(async ({ ctx, input }) => {
          const repo = new DrizzleCategoryRepository(ctx.tx, ctx.principal.orgId);
          const useCase = new CreateCategoryUseCase(repo, ctx.deps.clock, ctx.deps.ids);
          const result = await useCase.exec(
            {
              id: input.id,
              name: input.name,
              parentId: input.parentId ?? null,
              sortOrder: input.sortOrder,
            },
            ctx.principal.orgId,
          );
          return toCategoryDTO(orThrow(result));
        }),
    }),

    material: router({
      list: ownerOrOffice
        .input(materialListInput)
        .output(paginatedMaterialDTO)
        .query(async ({ ctx, input }) => {
          const repo = new DrizzleMaterialRepository(ctx.tx, ctx.principal.orgId);
          const useCase = new ListMaterialsUseCase(repo);
          const page = await useCase.exec({
            page: toPage({ limit: input.limit, cursor: input.cursor ?? null }),
            search: input.search,
            categoryId: input.categoryId,
          });
          return { items: page.items.map(toMaterialDTO), nextCursor: page.nextCursor };
        }),

      create: ownerOrOffice
        .input(materialCreateInput)
        .output(materialDTO)
        .mutation(async ({ ctx, input }) => {
          const repo = new DrizzleMaterialRepository(ctx.tx, ctx.principal.orgId);
          const useCase = new CreateMaterialUseCase(repo, ctx.deps.clock, ctx.deps.ids);
          const result = await useCase.exec(
            {
              id: input.id,
              name: input.name,
              categoryId: input.categoryId ?? null,
              code: input.code ?? null,
              description: input.description ?? null,
              unitCostCents: input.unitCostCents,
              unitOfMeasure: input.unitOfMeasure,
              markupBps: input.markupBps ?? null,
              taxable: input.taxable ?? false,
              vendor: input.vendor ?? null,
              active: input.active ?? true,
              position: input.position ?? 0,
            },
            ctx.principal.orgId,
          );
          return toMaterialDTO(orThrow(result));
        }),

      update: ownerOrOffice
        .input(materialUpdateInput)
        .output(materialDTO)
        .mutation(async ({ ctx, input }) => {
          const repo = new DrizzleMaterialRepository(ctx.tx, ctx.principal.orgId);
          const useCase = new UpdateMaterialUseCase(repo, ctx.deps.clock);
          const result = await useCase.exec(
            {
              materialId: asMaterialId(input.materialId),
              name: input.name,
              categoryId: input.categoryId,
              code: input.code,
              description: input.description,
              unitCostCents: input.unitCostCents,
              unitOfMeasure: input.unitOfMeasure,
              markupBps: input.markupBps,
              taxable: input.taxable,
              vendor: input.vendor,
              active: input.active,
              position: input.position,
            },
            ctx.principal.orgId,
          );
          return toMaterialDTO(orThrow(result));
        }),

      archive: ownerOrOffice
        .input(materialArchiveInput)
        .output(z.object({ ok: z.boolean() }))
        .mutation(async ({ ctx, input }) => {
          const repo = new DrizzleMaterialRepository(ctx.tx, ctx.principal.orgId);
          const useCase = new ArchiveMaterialUseCase(repo, ctx.deps.clock);
          const result = await useCase.exec(
            { materialId: asMaterialId(input.materialId) },
            ctx.principal.orgId,
          );
          return orThrow(result);
        }),
    }),

    serviceMaterial: router({
      listForService: ownerOrOffice
        .input(serviceMaterialListInput)
        .output(z.array(serviceMaterialDTO))
        .query(async ({ ctx, input }) => {
          const repo = new DrizzleServiceMaterialRepository(ctx.tx, ctx.principal.orgId);
          const useCase = new ListServiceMaterialsUseCase(repo);
          const joins = await useCase.exec({ serviceId: asServiceId(input.serviceId) });
          return joins.map(toServiceMaterialDTO);
        }),

      attach: ownerOrOffice
        .input(serviceMaterialAttachInput)
        .output(z.object({ ok: z.boolean() }))
        .mutation(async ({ ctx, input }) => {
          const serviceRepo = new DrizzleServiceRepository(ctx.tx, ctx.principal.orgId);
          const materialRepo = new DrizzleMaterialRepository(ctx.tx, ctx.principal.orgId);
          const smRepo = new DrizzleServiceMaterialRepository(ctx.tx, ctx.principal.orgId);
          const useCase = new AttachMaterialUseCase(serviceRepo, materialRepo, smRepo);
          const result = await useCase.exec(
            {
              serviceId: asServiceId(input.serviceId),
              materialId: asMaterialId(input.materialId),
              quantity: input.quantity,
            },
            ctx.principal.orgId,
          );
          orThrow(result);
          return { ok: true };
        }),

      detach: ownerOrOffice
        .input(serviceMaterialDetachInput)
        .output(z.object({ ok: z.boolean() }))
        .mutation(async ({ ctx, input }) => {
          const repo = new DrizzleServiceMaterialRepository(ctx.tx, ctx.principal.orgId);
          const useCase = new DetachMaterialUseCase(repo);
          const result = await useCase.exec(
            {
              serviceId: asServiceId(input.serviceId),
              materialId: asMaterialId(input.materialId),
            },
            ctx.principal.orgId,
          );
          return orThrow(result);
        }),
    }),

    // One-click starter pack for a brand-new org's empty pricebook (Task 8). Idempotent —
    // SeedPricebookUseCase no-ops if the org already has any service, so this is safe to
    // invoke more than once (a retry, a double click). The concrete plumbing content lives
    // in app/(office)/settings/pricebook-seed.ts, composed in here rather than hardcoded
    // into the module, which stays vertical-agnostic.
    seed: ownerOrOffice
      .output(seedPricebookDTO)
      .mutation(async ({ ctx }) => {
        const serviceRepo = new DrizzleServiceRepository(ctx.tx, ctx.principal.orgId);
        const categoryRepo = new DrizzleCategoryRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new SeedPricebookUseCase(
          serviceRepo,
          categoryRepo,
          ctx.deps.clock,
          ctx.deps.ids,
        );
        const result = await useCase.exec(ctx.principal.orgId, {
          categories: PLUMBING_SEED_CATEGORIES.map((name) => ({ name })),
          services: PLUMBING_SEED_SERVICES,
        });
        const seeded = orThrow(result);
        return {
          services: seeded.services.map(toServiceDTO),
          categories: seeded.categories.map(toCategoryDTO),
        };
      }),
  });
