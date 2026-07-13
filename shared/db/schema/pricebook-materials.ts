import { pgTable, uuid, text, integer, boolean, timestamp, index, unique, foreignKey } from "drizzle-orm/pg-core";
import { orgs } from "./orgs";
import { pricebookCategories } from "./pricebook-categories";

// A pricebook material — a hidden cost ingredient (a part/component), normally NOT shown to the
// customer. Materials are attached to a Service (see pricebook_service_materials) by quantity to
// build the service's cost basis. markup_bps is a per-material override of the org default
// (org_settings.markup_bps); null means "use the org default". unit_cost_cents = internal cost.
// RLS isolates by org_id (hand-written migration); soft-delete via deleted_at. unique(org_id, id)
// is the composite-FK target the join table references.
export const pricebookMaterials = pgTable(
  "pricebook_materials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id"),
    code: text("code"),
    name: text("name").notNull(),
    description: text("description"),
    unitCostCents: integer("unit_cost_cents").notNull().default(0),
    unitOfMeasure: text("unit_of_measure").notNull().default("each"),
    markupBps: integer("markup_bps"), // null → use org default markup
    taxable: boolean("taxable").notNull().default(false),
    vendor: text("vendor"), // one free-text field — no vendor entity (YAGNI)
    active: boolean("active").notNull().default(true),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    // Composite-unique target so pricebook_service_materials can FK on (org_id, id).
    unique("pricebook_materials_org_id_uq").on(t.orgId, t.id),
    index("pricebook_materials_org_deleted_idx").on(t.orgId, t.deletedAt),
    index("pricebook_materials_org_name_idx").on(t.orgId, t.name),
    // A material's category must belong to the same org.
    foreignKey({
      name: "pricebook_materials_category_fk",
      columns: [t.orgId, t.categoryId],
      foreignColumns: [pricebookCategories.orgId, pricebookCategories.id],
    }).onDelete("set null"),
  ],
);
