import { pgTable, uuid, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { orgs } from "./orgs";

// A selectable lead-source label ("Google", "Referral", …). Ordered, soft-deleteable.
export const leadSources = pgTable(
  "lead_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("lead_sources_org_deleted_idx").on(t.orgId, t.deletedAt)],
);
