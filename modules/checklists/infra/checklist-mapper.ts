import { asChecklistId, asChecklistItemId, asOrgId } from "@mallet/shared/types";
import { checklistTemplates, checklistItems } from "@mallet/shared/db/schema";
import { Checklist, ChecklistItem, isChecklistStage, isChecklistItemType } from "../domain/checklist";

// The persistence row shapes, inferred from the schema.
export type ChecklistRow = typeof checklistTemplates.$inferSelect;
export type ChecklistItemRow = typeof checklistItems.$inferSelect;

// Reconstruct a domain ChecklistItem from a DB row. Corrupt data throws rather than
// silently coercing — fail-fast per design principles.
const toItem = (row: ChecklistItemRow): ChecklistItem => {
  if (!isChecklistItemType(row.type)) {
    throw new Error(`corrupt checklist_item ${row.id}: unknown type "${row.type}"`);
  }
  const result = ChecklistItem.create({
    id: asChecklistItemId(row.id),
    text: row.text,
    type: row.type,
    required: row.required,
    position: row.position,
  });
  if (!result.ok) throw new Error(`corrupt checklist_item ${row.id}: ${result.error.message}`);
  return result.value;
};

// Reconstruct the aggregate from a header row + its (deleted-filtered) item rows.
// Items are sorted by position ascending before being handed to the domain factory,
// which will re-sort — harmless double sort, but keeps the contract obvious.
export const toDomain = (row: ChecklistRow, itemRows: readonly ChecklistItemRow[]): Checklist => {
  if (!isChecklistStage(row.stage)) {
    throw new Error(`corrupt checklist ${row.id}: unknown stage "${row.stage}"`);
  }
  const items = [...itemRows].sort((a, b) => a.position - b.position).map(toItem);
  const result = Checklist.create({
    id: asChecklistId(row.id),
    orgId: asOrgId(row.orgId),
    name: row.name,
    trade: row.trade,
    stage: row.stage,
    match: row.match,
    items,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
  if (!result.ok) throw new Error(`corrupt checklist ${row.id}: ${result.error.message}`);
  return result.value;
};
