import { z } from "zod";
import type { Service } from "../domain/service";
import type { ItemComponent } from "../domain/item-component";
import type { Category } from "../domain/category";
import type { Material } from "../domain/material";
import type { ServiceMaterial } from "../domain/service-material";

// Mirrors modules/pricebook/domain/service.ts's MEASURED_BY_KIND_SET, which is itself
// compile-time pinned to measurements' PaintingQuantityKind. Kept as a literal zod enum here
// (rather than importing the domain's derived array) so this DTO module stays a pure
// leaf — no import of domain constants required for a boundary schema.
export const measuredByKindDTO = z.enum([
  "hour",
  "walls_sqft",
  "ceiling_sqft",
  "soffit_sqft",
  "baseboard_lnft",
  "baseboard_sqft",
  "crown_lnft",
  "crown_sqft",
  "doors_count",
  "windows_count",
  "site_sqft",
  "site_lnft",
]);

/** One part of a saved assembly. No quantity — only the expression it is counted by. */
export const itemComponentDTO = z.object({
  id: z.string().uuid(),
  description: z.string(),
  unit: z.string().nullable(),
  qtyExpr: z.string().nullable(),
  roundUp: z.boolean(),
  unitCostCents: z.number().int().nonnegative(),
  unitPriceCents: z.number().int().nonnegative(),
  markupBps: z.number().int().nonnegative().nullable(),
  position: z.number().int(),
});

export type ItemComponentDTO = z.infer<typeof itemComponentDTO>;

export const toItemComponentDTO = (component: ItemComponent): ItemComponentDTO => {
  const p = component.props;
  return {
    id: p.id,
    description: p.description,
    unit: p.unit,
    qtyExpr: p.qtyExpr,
    roundUp: p.roundUp,
    unitCostCents: p.unitCostCents,
    unitPriceCents: p.unitPriceCents,
    markupBps: p.markupBps,
    position: p.position,
  };
};

export const serviceDTO = z.object({
  id: z.string().uuid(),
  categoryId: z.string().uuid().nullable(),
  code: z.string().nullable(),
  name: z.string(),
  description: z.string().nullable(),
  unitPriceCents: z.number().int().nonnegative(),
  costCents: z.number().int().nonnegative(),
  laborHours: z.number().nullable(),
  taxable: z.boolean(),
  warrantyText: z.string().nullable(),
  imageUrl: z.string().nullable(),
  isAddon: z.boolean(),
  active: z.boolean(),
  position: z.number().int(),
  measuredBy: measuredByKindDTO.nullable(),
  /** What the price is per, in the trade's own words ("LF"). Display only. */
  unit: z.string().nullable(),
  /**
   * The run a saved assembly's price is true for. Null on an ordinary service — see the
   * column's own note for why an assembly's rate cannot be read without it.
   */
  defaultQuantity: z.number().positive().nullable(),
  /**
   * The parts this entry is built from, when it is a saved ASSEMBLY. Empty on an ordinary
   * service — the presence of parts is what makes an entry an assembly, so there is no separate
   * flag that could disagree with the rows.
   */
  components: z.array(itemComponentDTO),
});

export type ServiceDTO = z.infer<typeof serviceDTO>;

export const categoryDTO = z.object({
  id: z.string().uuid(),
  parentId: z.string().uuid().nullable(),
  name: z.string(),
  sortOrder: z.number().int(),
});

export type CategoryDTO = z.infer<typeof categoryDTO>;

export const paginatedServiceDTO = z.object({
  items: z.array(serviceDTO),
  nextCursor: z.string().nullable(),
});

export type PaginatedServiceDTO = z.infer<typeof paginatedServiceDTO>;

export const materialDTO = z.object({
  id: z.string().uuid(),
  categoryId: z.string().uuid().nullable(),
  code: z.string().nullable(),
  name: z.string(),
  description: z.string().nullable(),
  unitCostCents: z.number().int().nonnegative(),
  unitPriceCents: z.number().int().nonnegative(),
  pricingMode: z.enum(["rule", "manual"]),
  unitOfMeasure: z.string(),
  markupBps: z.number().int().nullable(),
  taxable: z.boolean(),
  vendor: z.string().nullable(),
  active: z.boolean(),
  position: z.number().int(),
});

export type MaterialDTO = z.infer<typeof materialDTO>;

export const serviceMaterialDTO = z.object({
  serviceId: z.string().uuid(),
  materialId: z.string().uuid(),
  quantity: z.number(),
});

export type ServiceMaterialDTO = z.infer<typeof serviceMaterialDTO>;

export const paginatedMaterialDTO = z.object({
  items: z.array(materialDTO),
  nextCursor: z.string().nullable(),
});

export type PaginatedMaterialDTO = z.infer<typeof paginatedMaterialDTO>;

export const seedPricebookDTO = z.object({
  services: z.array(serviceDTO),
  categories: z.array(categoryDTO),
  materials: z.array(materialDTO),
});

export type SeedPricebookDTO = z.infer<typeof seedPricebookDTO>;

/**
 * A service, with its parts when it has any. `components` is a parameter rather than something
 * read here: the list path batches every entry's parts in one query, and a mapper that fetched
 * its own would be the N+1 that batching exists to avoid.
 */
export const toServiceDTO = (
  service: Service,
  components: readonly ItemComponent[] = [],
): ServiceDTO => {
  const p = service.props;
  return {
    id: p.id,
    categoryId: p.categoryId,
    code: p.code,
    name: p.name,
    description: p.description,
    unitPriceCents: p.unitPriceCents,
    costCents: p.costCents,
    laborHours: p.laborHours,
    taxable: p.taxable,
    warrantyText: p.warrantyText,
    imageUrl: p.imageUrl,
    isAddon: p.isAddon,
    active: p.active,
    position: p.position,
    measuredBy: p.measuredBy,
    unit: p.unit,
    defaultQuantity: p.defaultQuantity,
    components: components.map(toItemComponentDTO),
  };
};

export const toCategoryDTO = (category: Category): CategoryDTO => {
  const p = category.props;
  return {
    id: p.id,
    parentId: p.parentId,
    name: p.name,
    sortOrder: p.sortOrder,
  };
};

export const toMaterialDTO = (material: Material): MaterialDTO => {
  const p = material.props;
  return {
    id: p.id,
    categoryId: p.categoryId,
    code: p.code,
    name: p.name,
    description: p.description,
    unitCostCents: p.unitCostCents,
    unitPriceCents: p.unitPriceCents,
    pricingMode: p.pricingMode,
    unitOfMeasure: p.unitOfMeasure,
    markupBps: p.markupBps,
    taxable: p.taxable,
    vendor: p.vendor,
    active: p.active,
    position: p.position,
  };
};

export const toServiceMaterialDTO = (serviceMaterial: ServiceMaterial): ServiceMaterialDTO => {
  const p = serviceMaterial.props;
  return {
    serviceId: p.serviceId,
    materialId: p.materialId,
    quantity: p.quantity,
  };
};
