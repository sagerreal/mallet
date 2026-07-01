import type { CursorPage, Paginated } from "@mallet/shared/types";
import type { Estimate } from "../domain/estimate";
import type { EstimateRepository, EstimateFilter } from "../domain/estimate-repository";

export interface ListEstimatesQuery {
  readonly page: CursorPage;
  readonly filter?: EstimateFilter;
}

// Thin read use-case: keyset-paginate the org's estimates (header-only). Tenant scoping is
// enforced by the org-scoped transaction the repository runs in.
export class ListEstimatesUseCase {
  constructor(private readonly repo: EstimateRepository) {}

  exec(query: ListEstimatesQuery): Promise<Paginated<Estimate>> {
    return this.repo.list(query.page, query.filter);
  }
}
