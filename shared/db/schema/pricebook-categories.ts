import { pgTable, uuid, text, integer, timestamp, index, unique, foreignKey } from "drizzle-orm/pg-core";
import { orgs } from "./orgs";

// A pricebook category — a self-referential tree (Water Heaters → Tank → Gas) the office uses to
// organise and browse services. A small shop leaves it shallow or empty; a large flat-rate book
// (500–2,000 lines) needs it to be quotable. RLS isolates by org_id (hand-written migration);
// soft-delete via deletedAt. parent_id is nullable (a top-level category).
export const pricebookCategories = pgTable(
  "pricebook_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id"),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    // Composite-unique target so pricebook_items (and Phase-2 children) can FK on (org_id, id)
    // and never link across tenants — same pattern as checklist_templates_org_id_uq.
    unique("pricebook_categories_org_id_uq").on(t.orgId, t.id),
    index("pricebook_categories_org_deleted_idx").on(t.orgId, t.deletedAt),
    // Self-referential composite FK: a subcategory's parent must belong to the same org.
    foreignKey({
      name: "pricebook_categories_parent_fk",
      columns: [t.orgId, t.parentId],
      foreignColumns: [t.orgId, t.id],
    }).onDelete("set null"),
  ],
);
