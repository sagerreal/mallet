import type { CursorPage, Paginated } from "@mallet/shared/types";
import type { TimeEntry } from "../domain/time-entry";
import type { TimeEntryRepository, TimeEntryFilter } from "../domain/time-entry-repository";

export interface ListTimeEntriesQuery {
  readonly filter: TimeEntryFilter;
  readonly page: CursorPage;
}

// Thin read use-case. Tenant scoping is enforced by the org-scoped transaction the repository
// runs in, not by a parameter here.
export class ListTimeEntriesUseCase {
  constructor(private readonly entries: TimeEntryRepository) {}

  exec(query: ListTimeEntriesQuery): Promise<Paginated<TimeEntry>> {
    return this.entries.list(query.filter, query.page);
  }
}
