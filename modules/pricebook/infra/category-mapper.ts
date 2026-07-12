import { asCategoryId, asOrgId } from "@mallet/shared/types";
import { pricebookCategories } from "@mallet/shared/db/schema";
import { Category } from "../domain/category";

// The persistence row shape, inferred from the schema.
export type CategoryRow = typeof pricebookCategories.$inferSelect;

// Reconstruct a domain Category from a DB row. Corrupt data throws rather than silently
// coercing (mirrors job-mapper's toDomain precedent).
export const rowToCategory = (row: CategoryRow): Category => {
  const result = Category.create({
    id: asCategoryId(row.id),
    orgId: asOrgId(row.orgId),
    parentId: row.parentId,
    name: row.name,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
  if (!result.ok) {
    throw new Error(`corrupt pricebook_category ${row.id}: ${result.error.message}`);
  }
  return result.value;
};
