import { sql } from "drizzle-orm";
import { pgTable, uuid, text, integer, boolean, timestamp, index, unique, foreignKey, check } from "drizzle-orm/pg-core";
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
    // SELL side (Jul 30 2026 — materials became first-class sellable quote lines, the
    // $1k-cost/$3k-sell AC-unit model). unit_price_cents is STORED, never computed at
    // quote time: 'rule' mode derives it from unit_cost_cents via the org's markup bands
    // (recomputed on cost/band edits); 'manual' means the shop typed it and cost edits
    // never touch it. Editing the price directly flips an item to manual (HCP pattern).
    unitPriceCents: integer("unit_price_cents").notNull().default(0),
    pricingMode: text("pricing_mode").notNull().default("rule"),
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
    check("pricebook_materials_pricing_mode_ck", sql`${t.pricingMode} in ('rule','manual')`),
  ],
);

// The org's ONE cost-banded markup table (Profit Rhino shape: cheap parts marked up hard,
// big-ticket equipment gently — a flat % destroys margin on a $2 fitting and looks
// predatory on an $1,800 condenser). A band applies to costs >= min_cost_cents up to the
// next band's floor. A shop wanting flat % keeps a single $0 band. NO per-category or
// per-customer dimensions — that's the complexity the flat-rate leaders warn against.
// Orgs with no rows use DEFAULT_MARKUP_BANDS (app constant) — no backfill needed.
export const pricebookMarkupBands = pgTable(
  "pricebook_markup_bands",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    minCostCents: integer("min_cost_cents").notNull(),
    markupBps: integer("markup_bps").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("pricebook_markup_bands_org_floor_uq").on(t.orgId, t.minCostCents),
    index("pricebook_markup_bands_org_idx").on(t.orgId),
    check("pricebook_markup_bands_floor_ck", sql`${t.minCostCents} >= 0`),
    check("pricebook_markup_bands_bps_ck", sql`${t.markupBps} >= 0`),
  ],
);
