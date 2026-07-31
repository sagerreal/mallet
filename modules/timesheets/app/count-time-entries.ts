import type { TimeEntryRepository, TimeEntryFilter } from "../domain/time-entry-repository";

export interface CountTimeEntriesQuery {
  readonly filter: TimeEntryFilter;
}

/**
 * How many time entries match — used to tell an empty WEEK apart from an empty SHOP.
 *
 * The office panel is week-scoped, so "no rows" is ambiguous on its own: a shop that has never
 * clocked in and a shop whose crew took last week off render the identical empty grid. Only the
 * first should be offered the set-up-your-clock screen; showing it to a shop with months of
 * history reads as data loss.
 *
 * Tenant scoping is the org-scoped transaction the repository runs in, not a parameter here.
 */
export class CountTimeEntriesUseCase {
  constructor(private readonly entries: TimeEntryRepository) {}

  exec(query: CountTimeEntriesQuery): Promise<number> {
    return this.entries.count(query.filter);
  }
}
