import { asOrgId, asServiceId } from "@mallet/shared/types";
import { pricebookItems } from "@mallet/shared/db/schema";
import { Service, type PaintingQuantityKind } from "../domain/service";

// The persistence row shape, inferred from the schema. The `Service` domain aggregate maps to
// the `pricebook_items` table (kept under its original name for additive-migration safety);
// `name` <- `label`.
export type ServiceRow = typeof pricebookItems.$inferSelect;

// `labor_hours` is `numeric(5,2)` — Drizzle (no `mode: "number"`) returns/accepts it as a
// string. The domain works in numbers throughout; convert at the read/write boundary only.
const toLaborHours = (v: string | null): number | null => (v == null ? null : Number(v));

export const laborHoursToColumn = (v: number | null): string | null =>
  v == null ? null : String(v);

// Reconstruct a domain Service from a DB row. Corrupt data throws rather than silently
// coercing (mirrors job-mapper's toDomain/toVisit precedent). Cents stay integers — dollar
// conversion is store-side only (lib/store/dto-mapper.ts convention).
export const rowToService = (row: ServiceRow): Service => {
  const result = Service.create({
    id: asServiceId(row.id),
    orgId: asOrgId(row.orgId),
    categoryId: row.categoryId,
    code: row.code,
    name: row.label,
    description: row.description,
    unitPriceCents: row.unitPriceCents,
    costCents: row.costCents,
    laborHours: toLaborHours(row.laborHours),
    taxable: row.taxable,
    warrantyText: row.warrantyText,
    imageUrl: row.imageUrl,
    isAddon: row.isAddon,
    active: row.active,
    position: row.position,
    // DB CHECK constraint already enforces the 6-kind membership; Service.create re-validates
    // it too (defense in depth) and throws below if a row is somehow corrupt.
    measuredBy: row.measuredBy as PaintingQuantityKind | null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
  if (!result.ok) {
    throw new Error(`corrupt pricebook_item ${row.id}: ${result.error.message}`);
  }
  return result.value;
};
