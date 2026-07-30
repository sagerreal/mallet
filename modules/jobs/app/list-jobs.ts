import type { CursorPage, Paginated } from "@mallet/shared/types";
import type { Job } from "../domain/job";
import type { JobSort } from "../infra/job-sorts";
import type { JobRepository, JobFilter } from "../domain/job-repository";

export interface ListJobsQuery {
  /** Named sort. Absent keeps the historical newest-first ordering for existing callers. */
  readonly sort?: JobSort;
  readonly sortDir?: "asc" | "desc";
  readonly page: CursorPage;
  readonly filter?: JobFilter;
}

// Thin read use-case: keyset-paginate the org's jobs. Tenant scoping is enforced by the
// org-scoped transaction the repository runs in.
export class ListJobsUseCase {
  constructor(private readonly repo: JobRepository) {}

  exec(query: ListJobsQuery): Promise<Paginated<Job>> {
    return this.repo.list(query.page, query.filter, query.sort, query.sortDir);
  }
}
