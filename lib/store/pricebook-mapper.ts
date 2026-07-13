/**
 * lib/store/pricebook-mapper.ts
 * Single DTO<->store conversion site for the pricebook (services + categories).
 * Cents<->dollars conversion lives ONLY here (mirrors dto-mapper.ts's money rule) —
 * the DB/domain/DTOs carry integer cents (unitPriceCents/costCents); the store
 * carries dollars (unitPrice/cost). Used by both PricebookHydrator (list) and
 * pricebook-slice's mutation reconcile paths — one shape, one mapper.
 */

import type { RouterOutputs } from "@/lib/trpc/client";
import type { Service, Category, Material, ServiceMaterialLink } from "./types";

export type ServiceDTO = RouterOutputs["v1"]["pricebook"]["service"]["create"];
export type CategoryDTO = RouterOutputs["v1"]["pricebook"]["category"]["create"];
export type SeedPricebookDTO = RouterOutputs["v1"]["pricebook"]["seed"];
export type MaterialDTO = RouterOutputs["v1"]["pricebook"]["material"]["create"];
export type ServiceMaterialDTO =
  RouterOutputs["v1"]["pricebook"]["serviceMaterial"]["listForService"][number];

// ---------------------------------------------------------------------------
// DTO -> store (dollars)
// ---------------------------------------------------------------------------

export function serviceDtoToStore(dto: ServiceDTO): Service {
  return {
    id: dto.id,
    categoryId: dto.categoryId,
    code: dto.code,
    name: dto.name,
    unitPrice: dto.unitPriceCents / 100,
    cost: dto.costCents / 100,
    laborHours: dto.laborHours,
    taxable: dto.taxable,
    warrantyText: dto.warrantyText,
    imageUrl: dto.imageUrl,
    isAddon: dto.isAddon,
    active: dto.active,
    position: dto.position,
  };
}

export function categoryDtoToStore(dto: CategoryDTO): Category {
  return {
    id: dto.id,
    parentId: dto.parentId,
    name: dto.name,
    sortOrder: dto.sortOrder,
  };
}

/** Maps v1.pricebook.seed's response (possibly empty, when already-seeded) to store shapes. */
export function seedResultDtoToStore(dto: SeedPricebookDTO): {
  services: Service[];
  categories: Category[];
} {
  return {
    services: dto.services.map(serviceDtoToStore),
    categories: dto.categories.map(categoryDtoToStore),
  };
}

export function materialDtoToStore(dto: MaterialDTO): Material {
  return {
    id: dto.id,
    categoryId: dto.categoryId,
    code: dto.code,
    name: dto.name,
    description: dto.description,
    unitCost: dto.unitCostCents / 100,
    unitOfMeasure: dto.unitOfMeasure,
    markupBps: dto.markupBps,
    taxable: dto.taxable,
    vendor: dto.vendor,
    active: dto.active,
    position: dto.position,
  };
}

export function serviceMaterialDtoToStore(dto: ServiceMaterialDTO): ServiceMaterialLink {
  return {
    serviceId: dto.serviceId,
    materialId: dto.materialId,
    quantity: dto.quantity,
  };
}

// ---------------------------------------------------------------------------
// store -> create/update payloads (cents)
// ---------------------------------------------------------------------------

/** Fields the caller supplies to add a service — dollars (mirrors the store Service shape). */
export interface AddServiceFields {
  name: string;
  unitPrice: number; // dollars
  cost?: number; // dollars, defaults to 0
  categoryId?: string | null;
  code?: string | null;
  laborHours?: number | null;
  taxable?: boolean;
  warrantyText?: string | null;
  imageUrl?: string | null;
  isAddon?: boolean;
}

/** Payload for v1.pricebook.service.create (cents) — the client authors `id` for optimistic UI. */
export interface ServiceCreatePayload {
  id: string;
  name: string;
  categoryId: string | null;
  code: string | null;
  unitPriceCents: number;
  costCents: number;
  laborHours: number | null;
  taxable: boolean;
  warrantyText: string | null;
  imageUrl: string | null;
  isAddon: boolean;
}

export function serviceCreatePayload(id: string, fields: AddServiceFields): ServiceCreatePayload {
  return {
    id,
    name: fields.name,
    categoryId: fields.categoryId ?? null,
    code: fields.code ?? null,
    unitPriceCents: Math.max(0, Math.round(fields.unitPrice * 100)),
    costCents: Math.max(0, Math.round((fields.cost ?? 0) * 100)),
    laborHours: fields.laborHours ?? null,
    taxable: fields.taxable ?? false,
    warrantyText: fields.warrantyText ?? null,
    imageUrl: fields.imageUrl ?? null,
    isAddon: fields.isAddon ?? false,
  };
}

/** Patchable service fields (dollars) — a subset of the store Service shape. */
export type ServiceUpdateFields = Partial<
  Pick<
    Service,
    | "name"
    | "categoryId"
    | "code"
    | "unitPrice"
    | "cost"
    | "laborHours"
    | "taxable"
    | "warrantyText"
    | "imageUrl"
    | "isAddon"
    | "active"
    | "position"
  >
>;

export interface ServiceUpdatePayload {
  serviceId: string;
  name?: string;
  categoryId?: string | null;
  code?: string | null;
  unitPriceCents?: number;
  costCents?: number;
  laborHours?: number | null;
  taxable?: boolean;
  warrantyText?: string | null;
  imageUrl?: string | null;
  isAddon?: boolean;
  active?: boolean;
  position?: number;
}

export function serviceUpdatePayload(
  serviceId: string,
  fields: ServiceUpdateFields,
): ServiceUpdatePayload {
  return {
    serviceId,
    ...(fields.name !== undefined ? { name: fields.name } : {}),
    ...(fields.categoryId !== undefined ? { categoryId: fields.categoryId } : {}),
    ...(fields.code !== undefined ? { code: fields.code } : {}),
    ...(fields.unitPrice !== undefined
      ? { unitPriceCents: Math.max(0, Math.round(fields.unitPrice * 100)) }
      : {}),
    ...(fields.cost !== undefined ? { costCents: Math.max(0, Math.round(fields.cost * 100)) } : {}),
    ...(fields.laborHours !== undefined ? { laborHours: fields.laborHours } : {}),
    ...(fields.taxable !== undefined ? { taxable: fields.taxable } : {}),
    ...(fields.warrantyText !== undefined ? { warrantyText: fields.warrantyText } : {}),
    ...(fields.imageUrl !== undefined ? { imageUrl: fields.imageUrl } : {}),
    ...(fields.isAddon !== undefined ? { isAddon: fields.isAddon } : {}),
    ...(fields.active !== undefined ? { active: fields.active } : {}),
    ...(fields.position !== undefined ? { position: fields.position } : {}),
  };
}

export interface CategoryCreatePayload {
  id: string;
  name: string;
  parentId: string | null;
}

export function categoryCreatePayload(
  id: string,
  name: string,
  parentId?: string | null,
): CategoryCreatePayload {
  return { id, name, parentId: parentId ?? null };
}

// ---------------------------------------------------------------------------
// material create/update payloads (cents) — mirrors the service payloads above
// ---------------------------------------------------------------------------

/** Fields the caller supplies to add a material — dollars (mirrors the store Material shape). */
export interface AddMaterialFields {
  name: string;
  unitCost: number; // dollars
  categoryId?: string | null;
  code?: string | null;
  description?: string | null;
  unitOfMeasure?: string;
  markupBps?: number | null;
  taxable?: boolean;
  vendor?: string | null;
}

/** Payload for v1.pricebook.material.create (cents) — the client authors `id` for optimistic UI. */
export interface MaterialCreatePayload {
  id: string;
  name: string;
  categoryId: string | null;
  code: string | null;
  description: string | null;
  unitCostCents: number;
  unitOfMeasure: string;
  markupBps: number | null;
  taxable: boolean;
  vendor: string | null;
}

export function materialCreatePayload(id: string, fields: AddMaterialFields): MaterialCreatePayload {
  return {
    id,
    name: fields.name,
    categoryId: fields.categoryId ?? null,
    code: fields.code ?? null,
    description: fields.description ?? null,
    unitCostCents: Math.max(0, Math.round(fields.unitCost * 100)),
    unitOfMeasure: fields.unitOfMeasure ?? "each",
    markupBps: fields.markupBps ?? null,
    taxable: fields.taxable ?? false,
    vendor: fields.vendor ?? null,
  };
}

/** Patchable material fields (dollars) — a subset of the store Material shape. */
export type MaterialUpdateFields = Partial<
  Pick<
    Material,
    | "name"
    | "categoryId"
    | "code"
    | "description"
    | "unitCost"
    | "unitOfMeasure"
    | "markupBps"
    | "taxable"
    | "vendor"
    | "active"
    | "position"
  >
>;

export interface MaterialUpdatePayload {
  materialId: string;
  name?: string;
  categoryId?: string | null;
  code?: string | null;
  description?: string | null;
  unitCostCents?: number;
  unitOfMeasure?: string;
  markupBps?: number | null;
  taxable?: boolean;
  vendor?: string | null;
  active?: boolean;
  position?: number;
}

export function materialUpdatePayload(
  materialId: string,
  fields: MaterialUpdateFields,
): MaterialUpdatePayload {
  return {
    materialId,
    ...(fields.name !== undefined ? { name: fields.name } : {}),
    ...(fields.categoryId !== undefined ? { categoryId: fields.categoryId } : {}),
    ...(fields.code !== undefined ? { code: fields.code } : {}),
    ...(fields.description !== undefined ? { description: fields.description } : {}),
    ...(fields.unitCost !== undefined
      ? { unitCostCents: Math.max(0, Math.round(fields.unitCost * 100)) }
      : {}),
    ...(fields.unitOfMeasure !== undefined ? { unitOfMeasure: fields.unitOfMeasure } : {}),
    ...(fields.markupBps !== undefined ? { markupBps: fields.markupBps } : {}),
    ...(fields.taxable !== undefined ? { taxable: fields.taxable } : {}),
    ...(fields.vendor !== undefined ? { vendor: fields.vendor } : {}),
    ...(fields.active !== undefined ? { active: fields.active } : {}),
    ...(fields.position !== undefined ? { position: fields.position } : {}),
  };
}
