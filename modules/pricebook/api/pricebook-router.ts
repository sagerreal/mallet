import { z } from "zod";
import { router, ownerOrOffice } from "@/trpc/init";
import { orThrow } from "@/trpc/errors";
import { asServiceId, asMaterialId, toPage, isOk } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import { pricebookFor } from "@/app/(office)/settings/pricebooks";
import { DrizzleSettingsRepository, OrgSettings } from "@mallet/settings";
import { DrizzleServiceRepository } from "../infra/drizzle-service-repository";
import { DrizzleCategoryRepository } from "../infra/drizzle-category-repository";
import { DrizzleMaterialRepository } from "../infra/drizzle-material-repository";
import { DrizzleMarkupBandsRepository } from "../infra/drizzle-markup-bands-repository";
import { DEFAULT_MARKUP_BANDS } from "../domain/markup-bands";
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
  measuredByKindDTO,
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
  measuredBy: measuredByKindDTO.nullable().optional(),
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
  measuredBy: measuredByKindDTO.nullable().optional(),
});

const serviceArchiveInput = z.object({
  serviceId: z.string().uuid(),
});

// Bulk CSV import (mirrors `importCustomers` in lead-router.ts). `category` is a NAME, not an
// id — the client never sees category ids; the server resolves/creates them per row. Cents are
// re-validated server-side (never trust the client, even though it already parsed the money
// strings) — non-negative ints only.
const importServiceRowInput = z.object({
  name: z.string().min(1).max(500),
  category: z.string().max(255).nullable(),
  description: z.string().max(10_000).nullable(),
  code: z.string().max(120).nullable(),
  unitPriceCents: z.number().int().nonnegative(),
  costCents: z.number().int().nonnegative(),
  taxable: z.boolean(),
});
const importServicesInput = z.object({ rows: z.array(importServiceRowInput).min(1).max(500) });

const importResultDTO = z.object({
  created: z.number().int(),
  deduped: z.number().int(),
  failed: z.number().int(),
  errors: z.array(z.object({ index: z.number().int(), message: z.string() })),
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
  // Explicit sell price = manual mode from birth; absent → derived from the markup bands.
  unitPriceCents: z.number().int().nonnegative().optional(),
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
  // Direct price edit — the use-case flips the item to manual.
  unitPriceCents: z.number().int().nonnegative().optional(),
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
              measuredBy: input.measuredBy ?? null,
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
              measuredBy: input.measuredBy,
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

    // Bulk CSV import (mirrors `importCustomers` in lead-router.ts). Parse/validate happens
    // client-side (money strings → cents, column mapping); this endpoint re-validates and
    // writes. Every row is classified — never throws for an expected per-row failure, so one
    // bad row can't roll back the batch. Category find-or-create is cached for the whole batch
    // (loaded once up front) to avoid an N+1 lookup per row.
    importServices: ownerOrOffice
      .input(importServicesInput)
      .output(importResultDTO)
      .mutation(async ({ ctx, input }) => {
        const serviceRepo = new DrizzleServiceRepository(ctx.tx, ctx.principal.orgId);
        const categoryRepo = new DrizzleCategoryRepository(ctx.tx, ctx.principal.orgId);
        const createService = new CreateServiceUseCase(serviceRepo, ctx.deps.clock, ctx.deps.ids);
        const createCategory = new CreateCategoryUseCase(categoryRepo, ctx.deps.clock, ctx.deps.ids);
        const listCategories = new ListCategoriesUseCase(categoryRepo);

        // Load the org's categories ONCE, keyed by lowercased name — every row's category
        // lookup then hits this in-memory map instead of a per-row query (no N+1). Newly
        // created categories are added to the same map so later rows in the batch that share a
        // category name reuse the id rather than creating a duplicate.
        const existingCategories = await listCategories.exec();
        const categoryIdByName = new Map<string, string>();
        for (const category of existingCategories) {
          categoryIdByName.set(category.props.name.toLowerCase(), category.props.id);
        }

        let created = 0;
        let deduped = 0;
        let failed = 0;
        const errors: { index: number; message: string }[] = [];

        for (let i = 0; i < input.rows.length; i++) {
          const row = input.rows[i]!;

          // Resolve category find-or-create first — a row can't be created until its category
          // (if any) has an id. A blank/null category name means "uncategorised" (categoryId
          // null), not an error.
          const categoryName = row.category?.trim() || null;
          let categoryId: string | null = null;
          if (categoryName) {
            const key = categoryName.toLowerCase();
            const cachedId = categoryIdByName.get(key);
            if (cachedId) {
              categoryId = cachedId;
            } else {
              const categoryResult = await createCategory.exec(
                { name: categoryName },
                ctx.principal.orgId,
              );
              if (isOk(categoryResult)) {
                categoryId = categoryResult.value.props.id;
                categoryIdByName.set(key, categoryId);
              } else {
                // Category creation failed (e.g. blank-after-trim name) — count the row as
                // failed with the reason rather than aborting the batch.
                failed += 1;
                errors.push({ index: i, message: categoryResult.error.message });
                continue;
              }
            }
          }

          // exec returns a Result — NEVER throws for validation/dedupe, so one bad row can't
          // roll back the batch. CreateServiceUseCase signals a duplicate name via
          // err(conflict(...)) rather than an ok-side flag, so dedupe is detected by error kind.
          const serviceResult = await createService.exec(
            {
              id: undefined,
              name: row.name,
              categoryId,
              code: row.code,
              description: row.description,
              unitPriceCents: row.unitPriceCents,
              costCents: row.costCents,
              taxable: row.taxable,
            },
            ctx.principal.orgId,
          );

          if (isOk(serviceResult)) {
            created += 1;
          } else if (serviceResult.error.kind === "conflict") {
            deduped += 1;
          } else {
            failed += 1;
            errors.push({ index: i, message: serviceResult.error.message });
          }
        }

        logger.info(
          { orgId: ctx.principal.orgId, created, deduped, failed },
          "pricebook.services.imported",
        );
        return { created, deduped, failed, errors };
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
          const bands = new DrizzleMarkupBandsRepository(ctx.tx, ctx.principal.orgId);
          const useCase = new CreateMaterialUseCase(repo, bands, ctx.deps.clock, ctx.deps.ids);
          const result = await useCase.exec(
            {
              id: input.id,
              name: input.name,
              categoryId: input.categoryId ?? null,
              code: input.code ?? null,
              description: input.description ?? null,
              unitCostCents: input.unitCostCents,
              unitPriceCents: input.unitPriceCents,
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
          const bands = new DrizzleMarkupBandsRepository(ctx.tx, ctx.principal.orgId);
          const useCase = new UpdateMaterialUseCase(repo, bands, ctx.deps.clock);
          const result = await useCase.exec(
            {
              materialId: asMaterialId(input.materialId),
              name: input.name,
              categoryId: input.categoryId,
              code: input.code,
              description: input.description,
              unitCostCents: input.unitCostCents,
              unitPriceCents: input.unitPriceCents,
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

    // The org's ONE cost-banded markup table. list returns the DEFAULTS (flagged) when the
    // org has no stored rows, so the UI always shows the real numbers in effect. replaceAll
    // also re-derives every rule-mode material's sell price — a band edit IS a reprice.
    markupBands: router({
      list: ownerOrOffice
        .output(
          z.object({
            bands: z.array(z.object({ minCostCents: z.number().int(), markupBps: z.number().int() })),
            isDefault: z.boolean(),
          }),
        )
        .query(async ({ ctx }) => {
          const repo = new DrizzleMarkupBandsRepository(ctx.tx, ctx.principal.orgId);
          const stored = await repo.list();
          if (stored.length > 0) return { bands: stored, isDefault: false };
          return { bands: [...DEFAULT_MARKUP_BANDS], isDefault: true };
        }),

      replaceAll: ownerOrOffice
        .input(
          z.object({
            bands: z
              .array(
                z.object({
                  minCostCents: z.number().int().nonnegative(),
                  markupBps: z.number().int().nonnegative().max(100_000),
                }),
              )
              .min(1)
              .max(12)
              .refine(
                (bands) => new Set(bands.map((b) => b.minCostCents)).size === bands.length,
                { message: "two bands start at the same cost" },
              )
              .refine((bands) => bands.some((b) => b.minCostCents === 0), {
                message: "the table needs a band starting at $0",
              }),
          }),
        )
        .output(z.object({ ok: z.boolean(), repriced: z.number().int() }))
        .mutation(async ({ ctx, input }) => {
          const bandsRepo = new DrizzleMarkupBandsRepository(ctx.tx, ctx.principal.orgId);
          await bandsRepo.replaceAll(input.bands);
          // Reprice every RULE-mode material from the new table. Manual items and existing
          // quotes are untouched (locked spec). Small catalogs (hundreds) — one pass is fine.
          const materialRepo = new DrizzleMaterialRepository(ctx.tx, ctx.principal.orgId);
          const updater = new UpdateMaterialUseCase(materialRepo, bandsRepo, ctx.deps.clock);
          let repriced = 0;
          let cursor: string | null = null;
          do {
            const page = await materialRepo.list(toPage({ cursor }), {});
            for (const m of page.items) {
              if (m.props.pricingMode !== "rule") continue;
              const r = await updater.exec(
                { materialId: m.props.id, unitCostCents: m.props.unitCostCents },
                ctx.principal.orgId,
              );
              if (r.ok) repriced += 1;
            }
            cursor = page.nextCursor;
          } while (cursor);
          return { ok: true, repriced };
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
        // The shop's OWN trade decides the pack. This used to hand every org the plumbing
        // catalogue regardless — a roofer opening their pricebook to "Replace 40gal gas water
        // heater · $2,400" is being told the product was not built for them.
        const settings = await new DrizzleSettingsRepository(ctx.tx, ctx.principal.orgId)
          .getConfig(ctx.principal.orgId, OrgSettings.defaultBooking);
        const pack = pricebookFor(settings.props.trade);
        // No pack for this trade (including "Other") seeds NOTHING rather than falling back to
        // another trade's prices — a wrong catalogue is worse than an empty one.
        if (!pack) return { services: [], categories: [] };
        const result = await useCase.exec(ctx.principal.orgId, {
          categories: pack.categories.map((name: string) => ({ name })),
          services: pack.services,
        });
        const seeded = orThrow(result);
        return {
          services: seeded.services.map(toServiceDTO),
          categories: seeded.categories.map(toCategoryDTO),
        };
      }),
  });
