import type { Category } from "../domain/category";
import type { CategoryRepository } from "../domain/category-repository";

// Thin read use-case: the full category tree in one query — a shop's tree is small enough that
// pagination would add complexity without benefit. Tenant scoping is enforced by the org-scoped
// transaction the repository runs in, not by a parameter here.
export class ListCategoriesUseCase {
  constructor(private readonly repo: CategoryRepository) {}

  exec(): Promise<Category[]> {
    return this.repo.list();
  }
}
