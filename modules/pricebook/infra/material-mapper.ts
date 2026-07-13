import { asOrgId, asMaterialId } from "@mallet/shared/types";
import { pricebookMaterials } from "@mallet/shared/db/schema";
import { Material } from "../domain/material";

// The persistence row shape, inferred from the schema.
export type MaterialRow = typeof pricebookMaterials.$inferSelect;

// Reconstruct a domain Material from a DB row. Corrupt data throws rather than silently
// coercing (mirrors service-mapper's / job-mapper's rowToX precedent). Cents stay integers —
// dollar conversion is store-side only (lib/store/dto-mapper.ts convention). markup_bps stays
// as-is (number | null — null means "use the org default").
export const rowToMaterial = (row: MaterialRow): Material => {
  const result = Material.create({
    id: asMaterialId(row.id),
    orgId: asOrgId(row.orgId),
    categoryId: row.categoryId,
    code: row.code,
    name: row.name,
    description: row.description,
    unitCostCents: row.unitCostCents,
    unitOfMeasure: row.unitOfMeasure,
    markupBps: row.markupBps,
    taxable: row.taxable,
    vendor: row.vendor,
    active: row.active,
    position: row.position,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
  if (!result.ok) {
    throw new Error(`corrupt pricebook_material ${row.id}: ${result.error.message}`);
  }
  return result.value;
};
