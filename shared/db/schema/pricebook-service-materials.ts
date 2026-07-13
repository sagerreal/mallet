import { pgTable, uuid, numeric, timestamp, index, primaryKey, foreignKey } from "drizzle-orm/pg-core";
import { pricebookItems } from "./pricebook-items";
import { pricebookMaterials } from "./pricebook-materials";

// Join: which materials (and how many) build a Service's cost basis. A service's cost rollup =
// sum(material.unit_cost_cents × quantity). Composite FKs on (org_id, service_id) and
// (org_id, material_id) enforce intra-org containment — a service can only reference its own
// org's materials, closing the cross-tenant hole (RI checks run owner-side, bypassing RLS, so
// the composite key is what actually closes it). RLS keyed on org_id (hand-written migration).
export const pricebookServiceMaterials = pgTable(
  "pricebook_service_materials",
  {
    orgId: uuid("org_id").notNull(),
    serviceId: uuid("service_id").notNull(),
    materialId: uuid("material_id").notNull(),
    quantity: numeric("quantity", { precision: 8, scale: 2 }).notNull().default("1"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.serviceId, t.materialId] }),
    foreignKey({
      name: "pricebook_service_materials_service_fk",
      columns: [t.orgId, t.serviceId],
      foreignColumns: [pricebookItems.orgId, pricebookItems.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "pricebook_service_materials_material_fk",
      columns: [t.orgId, t.materialId],
      foreignColumns: [pricebookMaterials.orgId, pricebookMaterials.id],
    }).onDelete("cascade"),
    index("pricebook_service_materials_org_service_idx").on(t.orgId, t.serviceId),
  ],
);
