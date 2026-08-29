import { pgTable, uuid, text, integer, boolean, timestamp, index, unique, foreignKey, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { pricebookItems } from "./pricebook-items";

/**
 * The parts and labour a saved ASSEMBLY is built from — "Cedar privacy fence" as posts, rails,
 * pickets and labour, so a shop types it once and quotes it forever.
 *
 * A template, not a quote. There are no absolute quantities here: a component carries the
 * EXPRESSION it is counted by (`qty/8+1`), and the number only exists once the row lands on an
 * estimate with a driver quantity to count off. That is why this is not simply
 * `pricebook_service_materials` with more columns — that table's `quantity` is a fixed number
 * against a material row, which cannot say "one post every eight feet, plus one".
 *
 * The columns mirror `estimate_lines`' component columns exactly (unit, qty_expr, round_up,
 * unit cost, markup) so applying a saved assembly to a quote is a copy, not a translation.
 * A translation is where the two would drift.
 *
 * RLS keyed on org_id (hand-written migration — drizzle-kit does not emit it).
 */
export const pricebookItemComponents = pgTable(
  "pricebook_item_components",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    /** The pricebook item this is a part of — the assembly's parent line. */
    itemId: uuid("item_id").notNull(),
    description: text("description").notNull(),
    /** What the component is counted in ("ea", "hr"). Display only. */
    unit: text("unit"),
    /**
     * How the count is expressed against the assembly's quantity ("qty/8+1"). Null means the
     * component is a flat one-per-assembly — the `quantity` a plain line would carry.
     */
    qtyExpr: text("qty_expr"),
    roundUp: boolean("round_up").notNull().default(false),
    unitCostCents: integer("unit_cost_cents").notNull().default(0),
    unitPriceCents: integer("unit_price_cents").notNull().default(0),
    /** Set when the component prices FROM its cost. Null means the price was typed. */
    markupBps: integer("markup_bps"),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    unique("pricebook_item_components_org_id_uq").on(t.orgId, t.id),
    // Cross-tenant containment: a component can only belong to its own org's item. RI checks
    // run owner-side and bypass RLS, so the composite key is what actually closes the hole.
    foreignKey({
      name: "pricebook_item_components_item_fk",
      columns: [t.orgId, t.itemId],
      foreignColumns: [pricebookItems.orgId, pricebookItems.id],
    }).onDelete("cascade"),
    index("pricebook_item_components_org_item_idx").on(t.orgId, t.itemId),
    check(
      "pricebook_item_components_markup_check",
      sql`${t.markupBps} is null or ${t.markupBps} >= 0`,
    ),
  ],
);
