import type { Result, AppError, Clock } from "@mallet/shared/types";
import { ok, err, toPage } from "@mallet/shared/types";
import type { IdGenerator } from "@mallet/shared/ports";
import { logger } from "@mallet/shared/observability";
import type { Service, ServicePricedBy } from "../domain/service";
import type { Category } from "../domain/category";
import type { Material } from "../domain/material";
import type { ServiceRepository } from "../domain/service-repository";
import type { CategoryRepository } from "../domain/category-repository";
import type { MaterialRepository, MarkupBandsRepository } from "../domain/material-repository";
import { CreateCategoryUseCase } from "./create-category";
import { CreateServiceUseCase } from "./create-service";
import { CreateMaterialUseCase } from "./create-material";

export interface SeedCategoryInput {
  readonly name: string;
}

export interface SeedServiceInput {
  readonly name: string;
  readonly categoryName: string;
  readonly unitPriceCents: number;
  readonly costCents: number;
  /**
   * The measured quantity this line is priced PER, when the trade does not price per job.
   * Roofing sells by the square, fencing by the linear foot, painting by wall area — seeding
   * those as a flat per-job number would be worse than not seeding them, because the figure
   * reads as a whole-job price and is off by an order of magnitude.
   * Absent (undefined) means a flat per-job price, which is how the service trades work.
   */
  readonly measuredBy?: ServicePricedBy | null;
}

/**
 * A stock item the trade buys and consumes — paint by the gallon, caulk by the tube.
 *
 * SEPARATE FROM A SERVICE, and the unit is why. A service is priced per unit of WORK (a square
 * foot of wall); a material is bought in whatever the supplier sells (a gallon), and the two do
 * not convert without a coverage rate. Seeding materials as flat services would put "Interior
 * latex, eggshell · $38" in the list a shop quotes from, where it reads as a sellable job.
 *
 * Cost only, never a sell price: markup bands turn cost into price, and a starter pack that
 * hard-coded a margin would be inventing the shop's pricing for it.
 */
export interface SeedMaterialInput {
  readonly name: string;
  readonly unitCostCents: number;
  /** What one of it IS — "gal", "tube", "roll". Shown beside the cost. */
  readonly unitOfMeasure: string;
  /** The number the trade actually needs at the shelf, e.g. paint coverage per coat. */
  readonly description?: string;
  readonly categoryName?: string;
}

// Vertical-agnostic seed spec — this use-case has no idea what "plumbing" is. The concrete
// pack (app/(office)/settings/pricebook-seed.ts) is composed in by the router, keeping the
// module reusable if a second starter pack is ever added.
export interface SeedPricebookInput {
  readonly categories: readonly SeedCategoryInput[];
  readonly services: readonly SeedServiceInput[];
  /** Absent for a trade whose pack has none — seeds nothing, exactly as before. */
  readonly materials?: readonly SeedMaterialInput[];
}

export interface SeedPricebookResult {
  readonly categories: Category[];
  readonly services: Service[];
  readonly materials: Material[];
}

// A brand-new org's pricebook starts empty, which makes the Settings card look broken rather
// than inviting. This one-shot bootstrap creates a starter catalog (categories, then the
// services that reference them) so the first session has something to edit instead of add
// from scratch.
//
// IDEMPOTENT by construction: before creating anything it checks whether the org already has
// ANY service via a bounded (limit 1) list call — never a full-table scan, since the book can
// reach hundreds/thousands of rows. If one exists, seeding is a no-op: nothing is created and
// nothing already there is touched, so re-invoking the button (a retried request, a double
// click, a stale empty-state render) can never duplicate the catalog.
//
// Composes CreateCategoryUseCase / CreateServiceUseCase rather than writing to the repos
// directly, so the same name-dedupe/validation invariants apply to seeded rows as to any
// manually-added one. A create failure is NOT swallowed — it propagates (Result err, or a
// thrown repo exception) so the caller's transaction rolls back instead of leaving a half
// -seeded book.
export class SeedPricebookUseCase {
  constructor(
    private readonly serviceRepo: ServiceRepository,
    private readonly categoryRepo: CategoryRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    // Optional so every existing caller and test keeps compiling and keeps its exact behaviour:
    // no material repo means no materials, which is what a pack without them wants anyway.
    private readonly materialRepo?: MaterialRepository,
    private readonly bandsRepo?: MarkupBandsRepository,
  ) {}

  async exec(
    orgId: string,
    input: SeedPricebookInput,
  ): Promise<Result<SeedPricebookResult, AppError>> {
    const existing = await this.serviceRepo.list(toPage({ limit: 1 }), {});
    if (existing.items.length > 0) {
      logger.info({ orgId, servicesCreated: 0, categoriesCreated: 0 }, "pricebook.seed.skipped");
      return ok({ services: [], categories: [], materials: [] });
    }

    const createCategory = new CreateCategoryUseCase(this.categoryRepo, this.clock, this.ids);
    const createService = new CreateServiceUseCase(this.serviceRepo, this.clock, this.ids);

    const categoryIdByName = new Map<string, string>();
    const categories: Category[] = [];
    for (const cat of input.categories) {
      const result = await createCategory.exec({ name: cat.name }, orgId);
      if (!result.ok) return err(result.error);
      categoryIdByName.set(cat.name, result.value.props.id);
      categories.push(result.value);
    }

    const services: Service[] = [];
    // POSITION IS THE PACK'S OWN ORDER, and it is load-bearing rather than cosmetic.
    //
    // The measurement tracer auto-seeds ONE service per measured quantity onto a quote, and picks
    // it with `lowestPositionByKind` (modules/quoting/app/build-from-measurements.ts). Every
    // seeded service used to be created without a position, so create-service defaulted them all
    // to 0 — and the tie-break fell through to NAME, ALPHABETICALLY.
    //
    // That auto-quoted whichever line happened to sort first. A traced gutter run seeded "Copper
    // gutter installation" at $50/ln ft, 20x the aluminum line nobody chose; siding seeded cedar
    // at 13.8x vinyl; fencing seeded aluminum at 18.9x chain link. No human picked any of them.
    //
    // Passing the index makes the file's order the priority order, so each pack lists the option
    // a shop sells most of FIRST for each measured kind. Enforced by index.test.ts.
    for (const [position, svc] of input.services.entries()) {
      const result = await createService.exec(
        {
          name: svc.name,
          categoryId: categoryIdByName.get(svc.categoryName) ?? null,
          unitPriceCents: svc.unitPriceCents,
          costCents: svc.costCents,
          measuredBy: svc.measuredBy ?? null,
          position,
        },
        orgId,
      );
      if (!result.ok) return err(result.error);
      services.push(result.value);
    }

    // Materials LAST: a service is what the shop sells and must exist even if the pack carries no
    // stock list, so nothing above depends on this step.
    const materials: Material[] = [];
    if (input.materials?.length && this.materialRepo && this.bandsRepo) {
      const createMaterial = new CreateMaterialUseCase(
        this.materialRepo,
        this.bandsRepo,
        this.clock,
        this.ids,
      );
      for (const [position, mat] of input.materials.entries()) {
        const result = await createMaterial.exec(
          {
            name: mat.name,
            categoryId: categoryIdByName.get(mat.categoryName ?? "") ?? null,
            description: mat.description ?? null,
            unitCostCents: mat.unitCostCents,
            unitOfMeasure: mat.unitOfMeasure,
            position,
          },
          orgId,
        );
        if (!result.ok) return err(result.error);
        materials.push(result.value);
      }
    }

    logger.info(
      {
        orgId,
        servicesCreated: services.length,
        categoriesCreated: categories.length,
        materialsCreated: materials.length,
      },
      "pricebook.seeded",
    );

    return ok({ services, categories, materials });
  }
}
