import type { Result, AppError, Clock } from "@mallet/shared/types";
import { ok, err, toPage } from "@mallet/shared/types";
import type { IdGenerator } from "@mallet/shared/ports";
import { logger } from "@mallet/shared/observability";
import type { Service } from "../domain/service";
import type { Category } from "../domain/category";
import type { ServiceRepository } from "../domain/service-repository";
import type { CategoryRepository } from "../domain/category-repository";
import { CreateCategoryUseCase } from "./create-category";
import { CreateServiceUseCase } from "./create-service";

export interface SeedCategoryInput {
  readonly name: string;
}

export interface SeedServiceInput {
  readonly name: string;
  readonly categoryName: string;
  readonly unitPriceCents: number;
  readonly costCents: number;
}

// Vertical-agnostic seed spec — this use-case has no idea what "plumbing" is. The concrete
// pack (app/(office)/settings/pricebook-seed.ts) is composed in by the router, keeping the
// module reusable if a second starter pack is ever added.
export interface SeedPricebookInput {
  readonly categories: readonly SeedCategoryInput[];
  readonly services: readonly SeedServiceInput[];
}

export interface SeedPricebookResult {
  readonly categories: Category[];
  readonly services: Service[];
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
  ) {}

  async exec(
    orgId: string,
    input: SeedPricebookInput,
  ): Promise<Result<SeedPricebookResult, AppError>> {
    const existing = await this.serviceRepo.list(toPage({ limit: 1 }), {});
    if (existing.items.length > 0) {
      logger.info({ orgId, servicesCreated: 0, categoriesCreated: 0 }, "pricebook.seed.skipped");
      return ok({ services: [], categories: [] });
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
    for (const svc of input.services) {
      const result = await createService.exec(
        {
          name: svc.name,
          categoryId: categoryIdByName.get(svc.categoryName) ?? null,
          unitPriceCents: svc.unitPriceCents,
          costCents: svc.costCents,
        },
        orgId,
      );
      if (!result.ok) return err(result.error);
      services.push(result.value);
    }

    logger.info(
      { orgId, servicesCreated: services.length, categoriesCreated: categories.length },
      "pricebook.seeded",
    );

    return ok({ services, categories });
  }
}
