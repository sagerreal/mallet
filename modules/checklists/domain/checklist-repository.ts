import type { ChecklistId, ChecklistItemId, CursorPage, Paginated } from "@mallet/shared/types";
import type { Checklist } from "./checklist";

// The org is NEVER a parameter — it is implicit in the org-scoped transaction the repository
// is constructed with, so a caller physically cannot address another tenant's checklists.
export interface ChecklistRepository {
  create(input: {
    id: string;
    orgId: string;
    name: string;
    trade: string;
    stage: string;
    match: readonly string[];
  }): Promise<Checklist>;

  findById(id: ChecklistId): Promise<Checklist | null>;

  list(page: CursorPage): Promise<Paginated<Checklist>>;

  // Soft-delete the template (and cascade-soft-delete its items). Returns rows affected (0 = not found).
  archive(id: ChecklistId, now: Date): Promise<number>;

  // Append one ordered item to a template; returns the reloaded aggregate.
  addItem(input: {
    id: string;
    templateId: ChecklistId;
    text: string;
    type: string;
    position: number;
  }): Promise<Checklist>;

  // Soft-delete one item. Returns the reloaded aggregate (null if the template is gone).
  removeItem(templateId: ChecklistId, itemId: ChecklistItemId, now: Date): Promise<Checklist | null>;

  // Set an item's required flag. Returns the reloaded aggregate (null if not found).
  setItemRequired(
    templateId: ChecklistId,
    itemId: ChecklistItemId,
    required: boolean,
    now: Date,
  ): Promise<Checklist | null>;
}
