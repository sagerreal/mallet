import type { CursorPage, Paginated } from "@mallet/shared/types";
import type { Material } from "../domain/material";
import type { MaterialRepository } from "../domain/material-repository";

export interface ListMaterialsQuery {
  readonly page: CursorPage;
  readonly search?: string;
  readonly categoryId?: string | null;
}

// Thin read use-case: keyset-paginate + filter the org's active materials. Tenant scoping is
// enforced by the org-scoped transaction the repository runs in, not by a parameter here.
export class ListMaterialsUseCase {
  constructor(private readonly repo: MaterialRepository) {}

  exec(query: ListMaterialsQuery): Promise<Paginated<Material>> {
    return this.repo.list(query.page, {
      search: query.search,
      categoryId: query.categoryId,
    });
  }
}
