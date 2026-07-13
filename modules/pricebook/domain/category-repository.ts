import type { CategoryId } from "@mallet/shared/types";
import type { Category } from "./category";

// The org is NEVER a parameter — it is implicit in the org-scoped transaction the repository
// is constructed with, so a caller physically cannot address another tenant's categories.
export interface CategoryRepository {
  create(input: {
    id: string;
    orgId: string;
    parentId: string | null;
    name: string;
    sortOrder: number;
  }): Promise<Category>;

  // The full tree in one query — a shop's category tree is small, no pagination needed.
  list(): Promise<Category[]>;

  save(category: Category): Promise<void>;

  // Soft-delete via deletedAt. Returns the number of rows affected (0 = not found).
  archive(id: CategoryId, now: Date): Promise<number>;
}
