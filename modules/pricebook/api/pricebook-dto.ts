import { z } from "zod";
import type { Service } from "../domain/service";
import type { Category } from "../domain/category";
import type { Material } from "../domain/material";
import type { ServiceMaterial } from "../domain/service-material";

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
});

export type SeedPricebookDTO = z.infer<typeof seedPricebookDTO>;

export const toServiceDTO = (service: Service): ServiceDTO => {
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
