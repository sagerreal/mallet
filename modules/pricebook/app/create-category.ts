import type { Result, AppError, Clock } from "@mallet/shared/types";
import { validation, ok, err } from "@mallet/shared/types";
import type { IdGenerator } from "@mallet/shared/ports";
import { logger } from "@mallet/shared/observability";
import type { Category } from "../domain/category";
import type { CategoryRepository } from "../domain/category-repository";

export interface CreateCategoryCommand {
  readonly id?: string; // client-authored id; a new one is minted when absent
  readonly name: string;
  readonly parentId?: string | null;
  readonly sortOrder?: number;
}

export class CreateCategoryUseCase {
  constructor(
    private readonly repo: CategoryRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async exec(cmd: CreateCategoryCommand, orgId: string): Promise<Result<Category, AppError>> {
    const name = cmd.name.trim();
    if (name.length === 0) return err(validation("category name is required", "name"));

    const category = await this.repo.create({
      id: cmd.id ?? this.ids.newId(),
      orgId,
      parentId: cmd.parentId ?? null,
      name,
      sortOrder: cmd.sortOrder ?? 0,
    });

    logger.info({ categoryId: category.props.id, orgId }, "pricebook.category.created");

    return ok(category);
  }
}
