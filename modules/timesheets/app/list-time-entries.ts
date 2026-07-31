import type { CursorPage, Paginated } from "@mallet/shared/types";
import type { TimeEntry } from "../domain/time-entry";
import type { TimeEntryRepository, TimeEntryFilter } from "../domain/time-entry-repository";
import type { TimesheetSort } from "../infra/timesheet-sorts";

export interface ListTimeEntriesQuery {
  readonly filter: TimeEntryFilter;
  readonly page: CursorPage;
  /** Named sort — defaults to work date ascending, the order a week is worked and approved in. */
  readonly sort?: TimesheetSort;
  readonly sortDir?: "asc" | "desc";
}

// Thin read use-case. Tenant scoping is enforced by the org-scoped transaction the repository
// runs in, not by a parameter here.
export class ListTimeEntriesUseCase {
  constructor(private readonly entries: TimeEntryRepository) {}

  exec(query: ListTimeEntriesQuery): Promise<Paginated<TimeEntry>> {
    return this.entries.list(query.filter, query.page, query.sort, query.sortDir);
  }
}
