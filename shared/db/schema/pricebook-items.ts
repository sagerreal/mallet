import { pgTable, uuid, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { orgs } from "./orgs";

// A pricebook line. unit_price_cents = customer-facing price; cost_cents = internal cost (techs
// never see it). Ordered by position for a stable settings list. Soft-delete via deleted_at.
export const pricebookItems = pgTable(
  "pricebook_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    unitPriceCents: integer("unit_price_cents").notNull().default(0),
    costCents: integer("cost_cents").notNull().default(0),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("pricebook_items_org_deleted_idx").on(t.orgId, t.deletedAt)],
);
