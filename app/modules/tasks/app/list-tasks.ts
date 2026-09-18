import type { CursorPage, Paginated } from "@mallet/shared/types";
import type { Task } from "../domain/task";
import type { TaskRepository, TaskFilter } from "../domain/task-repository";

export interface ListTasksQuery {
  readonly page: CursorPage;
  readonly filter?: TaskFilter;
}

// Thin read use-case: keyset-paginate the org's tasks. Tenant scoping is enforced by the
// org-scoped transaction the repository runs in, not by a parameter here.
export class ListTasksUseCase {
  constructor(private readonly tasks: TaskRepository) {}

  exec(query: ListTasksQuery): Promise<Paginated<Task>> {
    return this.tasks.list(query.page, query.filter);
  }
}
