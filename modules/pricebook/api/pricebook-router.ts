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
// Every field but `name` is OPTIONAL, and that is load-bearing on re-import: an ABSENT key means
// the sheet had no such column, so an existing service keeps whatever it already holds, while an
// explicit null means the user mapped the column and left the cell blank — a deliberate clear.
// Collapsing the two would let "refresh my prices" wipe descriptions the shop maintains in-app.
const importServiceRowInput = z.object({
  name: z.string().min(1).max(500),
  category: z.string().max(255).nullable().optional(),
  description: z.string().max(10_000).nullable().optional(),
  code: z.string().max(120).nullable().optional(),
  unitPriceCents: z.number().int().nonnegative().optional(),
  costCents: z.number().int().nonnegative().optional(),
  taxable: z.boolean().optional(),
});
const importServicesInput = z.object({ rows: z.array(importServiceRowInput).min(1).max(500) });

// Same optional-means-absent rule as services (see above): an absent key leaves the stored value
// alone on re-import, an explicit null clears it.
const importMaterialRowInput = z.object({
  name: z.string().min(1).max(500),
  category: z.string().max(255).nullable().optional(),
  description: z.string().max(10_000).nullable().optional(),
  code: z.string().max(120).nullable().optional(),
  unitCostCents: z.number().int().nonnegative().optional(),
  /** Absent → the markup rule derives the price. Present → the material goes manual. */
  unitPriceCents: z.number().int().nonnegative().optional(),
  // Not nullable: the column is NOT NULL with an "each" default, so a blank cell means "leave it"
  // rather than "clear it" — there is nothing to clear it to.
  unitOfMeasure: z.string().max(40).optional(),
  vendor: z.string().max(255).nullable().optional(),
  taxable: z.boolean().optional(),
});

const importMaterialsInput = z.object({ rows: z.array(importMaterialRowInput).min(1).max(500) });

const importResultDTO = z.object({
  created: z.number().int(),
  // Rows that matched an existing service and PATCHED it. Distinct from `deduped`, which means
  // "matched and left alone" — the customers importer still reports that, services no longer can.
  updated: z.number().int(),
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
      /**
       * Every live service NAME, lowercased. Exists so the import confirm step can say "412 new ·
       * 88 will be updated" before writing anything — a re-import overwrites records, and the
       * shop has to see that coming.
       *
       * Names only, deliberately: the full DTO for a large book is a lot of payload for a
       * question that is answered by string comparison. Unpaginated for the same reason — the
       * whole point is a complete set, and a name is a few dozen bytes.
       */
      importNames: ownerOrOffice
        .output(z.object({ names: z.array(z.string()) }))
        .query(async ({ ctx }) => {
          const repo = new DrizzleServiceRepository(ctx.tx, ctx.principal.orgId);
          const names = await repo.allNames();
          return { names: names.map((n) => n.trim().toLowerCase()) };
        }),

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
              taxable: input.taxable ?? true,
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
        const updateService = new UpdateServiceUseCase(serviceRepo, ctx.deps.clock);
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

        // Find a live service by exact name, case-insensitively — the same rule
        // CreateServiceUseCase applies when it decides a name is taken, so the row that was
        // rejected as a duplicate is the row we patch. `search` narrows on the name index rather
        // than scanning the whole book.
        const findServiceByName = async (name: string) => {
          const wanted = name.trim().toLowerCase();
          const candidates = await serviceRepo.list(toPage(), { search: name.trim() });
          return candidates.items.find((s) => s.props.name.toLowerCase() === wanted) ?? null;
        };

        let created = 0;
        let updated = 0;
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
              code: row.code ?? null,
              description: row.description ?? null,
              // A NEW service whose sheet carried no price column starts at zero — the same
              // place a hand-created one starts. (On UPDATE the absent key is passed through as
              // undefined instead, so an existing price is left alone.)
              unitPriceCents: row.unitPriceCents ?? 0,
              costCents: row.costCents ?? 0,
              taxable: row.taxable,
            },
            ctx.principal.orgId,
          );

          if (isOk(serviceResult)) {
            created += 1;
            continue;
          }

          if (serviceResult.error.kind !== "conflict") {
            failed += 1;
            errors.push({ index: i, message: serviceResult.error.message });
            continue;
          }

          // A name collision is a RE-IMPORT, not a rejection: the shop is refreshing a price book
          // it already has. Patch the existing service instead of skipping the row, which is what
          // every comparable product does and what makes an annual price update possible at all.
          //
          // Only the keys this row actually carries are passed — an absent key leaves the stored
          // value alone (Service.patch ignores undefined), so a two-column sheet cannot wipe the
          // rest of the record.
          const existing = await findServiceByName(row.name);
          if (!existing) {
            // The conflict came from somewhere we cannot now find — an archived row, or a
            // concurrent write. Report it rather than silently doing nothing.
            failed += 1;
            errors.push({ index: i, message: `Could not update the existing "${row.name}".` });
            continue;
          }

          const patched = await updateService.exec(
            {
              serviceId: existing.props.id,
              ...(categoryName !== null ? { categoryId } : {}),
              ...(row.code !== undefined ? { code: row.code } : {}),
              ...(row.description !== undefined ? { description: row.description } : {}),
              ...(row.unitPriceCents !== undefined ? { unitPriceCents: row.unitPriceCents } : {}),
              ...(row.costCents !== undefined ? { costCents: row.costCents } : {}),
              ...(row.taxable !== undefined ? { taxable: row.taxable } : {}),
            },
            ctx.principal.orgId,
          );

          if (isOk(patched)) {
            updated += 1;
          } else {
            failed += 1;
            errors.push({ index: i, message: patched.error.message });
          }
        }

        logger.info(
          { orgId: ctx.principal.orgId, created, updated, failed },
          "pricebook.services.imported",
        );
        // Services are never "deduped" now — a name match is patched, not skipped — but the field
        // stays in the shared DTO for the customers importer, which still means it.
        return { created, updated, deduped: 0, failed, errors };
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

    // Bulk CSV import for materials. Same contract as importServices: a name collision PATCHES the
    // existing material rather than skipping the row, and only the keys the sheet actually carries
    // are written (an absent key leaves the stored value alone).
    importMaterials: ownerOrOffice
      .input(importMaterialsInput)
      .output(importResultDTO)
      .mutation(async ({ ctx, input }) => {
        const orgId = ctx.principal.orgId;
        const materialRepo = new DrizzleMaterialRepository(ctx.tx, orgId);
        const categoryRepo = new DrizzleCategoryRepository(ctx.tx, orgId);
        const bands = new DrizzleMarkupBandsRepository(ctx.tx, orgId);
        const createMaterial = new CreateMaterialUseCase(materialRepo, bands, ctx.deps.clock, ctx.deps.ids);
        const updateMaterial = new UpdateMaterialUseCase(materialRepo, bands, ctx.deps.clock);
        const createCategory = new CreateCategoryUseCase(categoryRepo, ctx.deps.clock, ctx.deps.ids);

        // Categories loaded ONCE for the batch, with new ones folded back in, so a chunk sharing
        // a category name reuses the id instead of creating duplicates (no N+1).
        const categoryIdByName = new Map<string, string>();
        for (const category of await new ListCategoriesUseCase(categoryRepo).exec()) {
          categoryIdByName.set(category.props.name.toLowerCase(), category.props.id);
        }

        const findMaterialByName = async (name: string) => {
          const wanted = name.trim().toLowerCase();
          const candidates = await materialRepo.list(toPage(), { search: name.trim() });
          return candidates.items.find((m) => m.props.name.toLowerCase() === wanted) ?? null;
        };

        /**
         * Overwrite the material this row's name already matches. Only the keys the SHEET carries
         * are passed — an absent key leaves the stored value alone (Material.patch ignores
         * undefined), so a cost-only supplier sheet cannot wipe vendors or descriptions.
         */
        const patchExistingMaterial = async (
          row: z.infer<typeof importMaterialRowInput>,
          categoryName: string | null,
          categoryId: string | null,
        ): Promise<{ ok: true } | { ok: false; message: string }> => {
          const existing = await findMaterialByName(row.name);
          // The conflict came from somewhere we cannot now find — an archived row, or a
          // concurrent write. Reported rather than silently doing nothing.
          if (!existing) return { ok: false, message: `Could not update the existing "${row.name}".` };

          const patched = await updateMaterial.exec(
            {
              materialId: existing.props.id,
              ...(categoryName !== null ? { categoryId } : {}),
              ...(row.code !== undefined ? { code: row.code } : {}),
              ...(row.description !== undefined ? { description: row.description } : {}),
              ...(row.unitCostCents !== undefined ? { unitCostCents: row.unitCostCents } : {}),
              ...(row.unitPriceCents !== undefined ? { unitPriceCents: row.unitPriceCents } : {}),
              ...(row.unitOfMeasure !== undefined ? { unitOfMeasure: row.unitOfMeasure } : {}),
              ...(row.vendor !== undefined ? { vendor: row.vendor } : {}),
              ...(row.taxable !== undefined ? { taxable: row.taxable } : {}),
            },
            orgId,
          );
          return isOk(patched) ? { ok: true } : { ok: false, message: patched.error.message };
        };

        let created = 0;
        let updated = 0;
        let failed = 0;
        const errors: { index: number; message: string }[] = [];

        /**
         * Find-or-create a category, reusing the batch's map so a chunk sharing a category name
         * makes one row rather than one per line. Returns undefined when the NAME was present but
         * could not be created — the caller counts that row failed.
         */
        const resolveCategory = async (
          name: string | null,
        ): Promise<{ id: string | null } | { error: string }> => {
          if (!name) return { id: null };
          const key = name.toLowerCase();
          const cached = categoryIdByName.get(key);
          if (cached) return { id: cached };
          const made = await createCategory.exec({ name }, orgId);
          if (!isOk(made)) return { error: made.error.message };
          categoryIdByName.set(key, made.value.props.id);
          return { id: made.value.props.id };
        };

        for (let i = 0; i < input.rows.length; i++) {
          const row = input.rows[i]!;

          const categoryName = row.category?.trim() || null;
          const category = await resolveCategory(categoryName);
          if ("error" in category) {
            failed += 1;
            errors.push({ index: i, message: category.error });
            continue;
          }
          const categoryId = category.id;

          const result = await createMaterial.exec(
            {
              name: row.name,
              categoryId,
              code: row.code ?? null,
              description: row.description ?? null,
              unitCostCents: row.unitCostCents ?? 0,
              // Absent price → rule mode, derived from cost by the markup bands. Passing one
              // flips the material to manual, the same one-gesture override the pricebook offers.
              ...(row.unitPriceCents !== undefined ? { unitPriceCents: row.unitPriceCents } : {}),
              ...(row.unitOfMeasure ? { unitOfMeasure: row.unitOfMeasure } : {}),
              vendor: row.vendor ?? null,
              taxable: row.taxable,
            },
            orgId,
          );

          if (isOk(result)) {
            created += 1;
            continue;
          }

          if (result.error.kind !== "conflict") {
            failed += 1;
            errors.push({ index: i, message: result.error.message });
            continue;
          }

          const patched = await patchExistingMaterial(row, categoryName, categoryId);
          if (patched.ok) {
            updated += 1;
          } else {
            failed += 1;
            errors.push({ index: i, message: patched.message });
          }
        }

        logger.info({ orgId, created, updated, failed }, "pricebook.materials.imported");
        return { created, updated, deduped: 0, failed, errors };
      }),

    material: router({
      /** Live material names, lowercased — powers the import confirm step's new/updated split. */
      importNames: ownerOrOffice
        .output(z.object({ names: z.array(z.string()) }))
        .query(async ({ ctx }) => {
          const repo = new DrizzleMaterialRepository(ctx.tx, ctx.principal.orgId);
          const names = await repo.allNames();
          return { names: names.map((n) => n.trim().toLowerCase()) };
        }),

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
              taxable: input.taxable ?? true,
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
