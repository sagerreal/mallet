import type { CursorPage, Paginated } from "@mallet/shared/types";
import type { Lead } from "../domain/lead";
import type { LeadRepository, LeadFilter } from "../domain/lead-repository";

export interface ListLeadsQuery {
  readonly page: CursorPage;
  readonly filter?: LeadFilter;
}

// Thin read use-case: keyset-paginate the org's leads. Tenant scoping is enforced by the
// org-scoped transaction the repository runs in, not by a parameter here.
export class ListLeadsUseCase {
  constructor(private readonly leads: LeadRepository) {}

  exec(query: ListLeadsQuery): Promise<Paginated<Lead>> {
    return this.leads.list(query.page, query.filter);
  }
}
