import type { CursorPage, Paginated } from "@mallet/shared/types";
import type { Job } from "../domain/job";
import type { JobRepository, JobFilter } from "../domain/job-repository";

export interface ListJobsQuery {
  readonly page: CursorPage;
  readonly filter?: JobFilter;
}

// Thin read use-case: keyset-paginate the org's jobs. Tenant scoping is enforced by the
// org-scoped transaction the repository runs in.
export class ListJobsUseCase {
  constructor(private readonly repo: JobRepository) {}

  exec(query: ListJobsQuery): Promise<Paginated<Job>> {
    return this.repo.list(query.page, query.filter);
  }
}
