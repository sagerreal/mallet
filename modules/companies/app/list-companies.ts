import type { CursorPage, Paginated } from "@mallet/shared/types";
import type { Company } from "../domain/company";
import type { CompanyRepository } from "../domain/company-repository";

export interface ListCompaniesQuery {
  readonly page: CursorPage;
}

// Thin read use-case: keyset-paginate the org's active companies. Tenant scoping is enforced
// by the org-scoped transaction the repository runs in, not by a parameter here.
export class ListCompaniesUseCase {
  constructor(private readonly companies: CompanyRepository) {}

  exec(query: ListCompaniesQuery): Promise<Paginated<Company>> {
    return this.companies.list(query.page);
  }
}
