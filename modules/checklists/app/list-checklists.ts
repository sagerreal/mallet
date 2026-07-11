import type { CursorPage, Paginated } from "@mallet/shared/types";
import type { Checklist } from "../domain/checklist";
import type { ChecklistRepository } from "../domain/checklist-repository";

export interface ListChecklistsQuery {
  readonly page: CursorPage;
}

// Thin read use-case: keyset-paginate the org's active checklist templates (with items).
// Tenant scoping is enforced by the org-scoped transaction the repository runs in.
export class ListChecklistsUseCase {
  constructor(private readonly checklists: ChecklistRepository) {}

  exec(query: ListChecklistsQuery): Promise<Paginated<Checklist>> {
    return this.checklists.list(query.page);
  }
}
