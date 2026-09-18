import type { CursorPage, Paginated } from "@mallet/shared/types";
import type { Service } from "../domain/service";
import type { ServiceRepository } from "../domain/service-repository";

export interface ListServicesQuery {
  readonly page: CursorPage;
  readonly search?: string;
  readonly categoryId?: string | null;
}

// Thin read use-case: keyset-paginate + filter the org's active services. Tenant scoping is
// enforced by the org-scoped transaction the repository runs in, not by a parameter here.
export class ListServicesUseCase {
  constructor(private readonly repo: ServiceRepository) {}

  exec(query: ListServicesQuery): Promise<Paginated<Service>> {
    return this.repo.list(query.page, {
      search: query.search,
      categoryId: query.categoryId,
    });
  }
}
