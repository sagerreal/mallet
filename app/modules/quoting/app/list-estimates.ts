import type { CursorPage, Paginated } from "@mallet/shared/types";
import type { Estimate } from "../domain/estimate";
import type { EstimateRepository, EstimateFilter } from "../domain/estimate-repository";
import type { EstimateSort } from "../infra/estimate-sorts";

export interface ListEstimatesQuery {
  readonly page: CursorPage;
  readonly filter?: EstimateFilter;
  /** Named sort — absent keeps the historical newest-first ordering. */
  readonly sort?: EstimateSort;
  readonly sortDir?: "asc" | "desc";
}

// Thin read use-case: keyset-paginate the org's estimates (header-only). Tenant scoping is
// enforced by the org-scoped transaction the repository runs in.
export class ListEstimatesUseCase {
  constructor(private readonly repo: EstimateRepository) {}

  exec(query: ListEstimatesQuery): Promise<Paginated<Estimate>> {
    return this.repo.list(query.page, query.filter, query.sort, query.sortDir);
  }
}
