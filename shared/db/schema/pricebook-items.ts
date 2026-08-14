import { pgTable, uuid, text, integer, numeric, boolean, timestamp, index, unique, foreignKey, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { orgs } from "./orgs";
import { pricebookCategories } from "./pricebook-categories";

// A pricebook line — the sellable task→price "Service" (the domain object is `Service`; the table
// keeps its original name for additive-migration safety on the shared dev/prod DB). unit_price_cents
// = customer-facing flat price; cost_cents = internal cost (techs never see it). The columns beyond
// label/price/cost/position were added additively (Phase 1 pricebook restructure): category, code,
// description, labor hours, taxable, warranty, image, add-on flag, active. RLS + soft-delete.
export const pricebookItems = pgTable(
  "pricebook_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    // nullable: an uncategorised service is valid. Composite FK (org_id, category_id) below closes
    // the cross-tenant hole (a service can only reference its own org's category).
    categoryId: uuid("category_id"),
    code: text("code"),
    label: text("label").notNull(), // Service name (kept as `label` — additive-only, no rename).
    description: text("description"),
    unitPriceCents: integer("unit_price_cents").notNull().default(0),
    costCents: integer("cost_cents").notNull().default(0),
    laborHours: numeric("labor_hours", { precision: 5, scale: 2 }),
    /**
     * Does this service take sales tax. Seeds `taxable` on every estimate/job/invoice line raised
     * from it, overridable per line — Housecall Pro's model exactly.
     *
     * DEFAULT FLIPPED false → true (migration 0142), and the existing rows backfilled with it. The
     * column shipped as `false` when nothing on earth read it; a shop that then set a rate would
     * have seen $0 tax on a bill because every item in its book was silently non-taxable. `false`
     * was a schema default, never a shop's answer to a question it was never asked.
     */
    taxable: boolean("taxable").notNull().default(true),
    warrantyText: text("warranty_text"),
    imageUrl: text("image_url"),
    isAddon: boolean("is_addon").notNull().default(false),
    active: boolean("active").notNull().default(true),
    position: integer("position").notNull().default(0),
    // Nullable: null = flat price (today's unchanged semantics). When set, unit_price_cents is
    // a PER-UNIT rate against this measured quantity kind — a room kind (e.g. painting walls
    // priced per sqft), a site kind (a traced outdoor surface's area/perimeter), or 'hour'.
    // Mirrors measurements' PaintingQuantityKind/SiteQuantityKind — see
    // modules/pricebook/domain/service.ts's MEASURED_BY_KIND_SET/SITE_KIND_SET (compile-time
    // pinned to the measurements module's types without importing its barrel).
    measuredBy: text("measured_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    // Composite-unique target so pricebook_service_materials can FK on (org_id, id) — a service
    // can only be linked to its own org's materials. Safe additively: id is already the PK
    // (globally unique), so (org_id, id) can never have duplicates.
    unique("pricebook_items_org_id_uq").on(t.orgId, t.id),
    index("pricebook_items_org_deleted_idx").on(t.orgId, t.deletedAt),
    // Browse/filter services within a category; equality on category_id uses this.
    index("pricebook_items_org_category_idx").on(t.orgId, t.categoryId),
    // Name search (ilike) for the pricebook list at 500–2,000 rows.
    index("pricebook_items_org_name_idx").on(t.orgId, t.label),
    // Cross-tenant containment: a service's category must belong to the same org.
    foreignKey({
      name: "pricebook_items_category_fk",
      columns: [t.orgId, t.categoryId],
      foreignColumns: [pricebookCategories.orgId, pricebookCategories.id],
    }).onDelete("set null"),
    check(
      "pricebook_items_measured_by_check",
      sql`${t.measuredBy} is null or ${t.measuredBy} in ('hour', 'walls_sqft', 'ceiling_sqft', 'soffit_sqft', 'baseboard_lnft', 'crown_lnft', 'doors_count', 'windows_count', 'site_sqft', 'site_lnft')`,
    ),
  ],
);
