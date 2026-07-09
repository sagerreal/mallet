import type { TaskId, LeadId, CursorPage, Paginated } from "@mallet/shared/types";
import type { Task } from "./task";

export interface TaskFilter {
  readonly done?: boolean;
  readonly leadId?: LeadId;
}

// The org is NEVER a parameter — it is implicit in the org-scoped transaction the repository
// is constructed with, so a caller physically cannot address another tenant's tasks.
export interface TaskRepository {
  create(input: {
    id: string;
    orgId: string;
    leadId: string | null;
    text: string;
    dueDate: string | null;
  }): Promise<Task>;

  findById(id: TaskId): Promise<Task | null>;

  list(page: CursorPage, filter?: TaskFilter): Promise<Paginated<Task>>;

  save(task: Task): Promise<void>;

  // Soft-delete via deletedAt. Returns the number of rows affected (0 = not found).
  remove(id: TaskId, now: Date): Promise<number>;
}
