import type { ChecklistId, ChecklistItemId, OrgId, CursorPage, Paginated } from "@mallet/shared/types";
import type { Checklist, ChecklistStage, ChecklistItemType } from "./checklist";

// The org is NEVER a parameter — it is implicit in the org-scoped transaction the repository
// is constructed with, so a caller physically cannot address another tenant's checklists.
export interface ChecklistRepository {
  // Create the template header and (optionally) its initial items ATOMICALLY.
  // Batched create+addItem calls raced each other server-side (addItem's tx could
  // not see the template's uncommitted insert) — initial items belong in the create.
  create(input: {
    id: ChecklistId;
    orgId: OrgId;
    name: string;
    trade: string;
    stage: ChecklistStage;
    match: readonly string[];
    items?: readonly {
      id: ChecklistItemId;
      text: string;
      type: ChecklistItemType;
      required: boolean;
      position: number;
    }[];
  }): Promise<Checklist>;

  findById(id: ChecklistId): Promise<Checklist | null>;

  list(page: CursorPage): Promise<Paginated<Checklist>>;

  // Soft-delete the template (and cascade-soft-delete its items). Returns rows affected (0 = not found).
  archive(id: ChecklistId, now: Date): Promise<number>;

  // Replace the template's name + items atomically: update the header name, hard-remove the
  // template's current items, insert the new ordered set — all in the org-scoped tx. Returns the
  // updated Checklist, or null if the template doesn't exist (in this org).
  // trade/stage/match are intentionally NOT changed by this operation.
  update(input: {
    id: ChecklistId;
    name: string;
    items: readonly {
      id: ChecklistItemId;
      text: string;
      type: ChecklistItemType;
      required: boolean;
      position: number;
    }[];
  }): Promise<Checklist | null>;
}
