import { z } from "zod";
import { router, ownerOrOffice } from "@/trpc/init";
import { orThrow } from "@/trpc/errors";
import { asServiceId, asCategoryId, toPage } from "@mallet/shared/types";
import {
  PLUMBING_SEED_CATEGORIES,
  PLUMBING_SEED_SERVICES,
} from "@/app/(office)/settings/pricebook-seed";
import { DrizzleServiceRepository } from "../infra/drizzle-service-repository";
import { DrizzleCategoryRepository } from "../infra/drizzle-category-repository";
import { CreateServiceUseCase } from "../app/create-service";
import { UpdateServiceUseCase } from "../app/update-service";
import { ArchiveServiceUseCase } from "../app/archive-service";
import { ListServicesUseCase } from "../app/list-services";
import { CreateCategoryUseCase } from "../app/create-category";
import { ListCategoriesUseCase } from "../app/list-categories";
import { SeedPricebookUseCase } from "../app/seed-pricebook";
import {
  serviceDTO,
  categoryDTO,
  paginatedServiceDTO,
  toServiceDTO,
  toCategoryDTO,
  seedPricebookDTO,
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
