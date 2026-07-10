import { pgTable, uuid, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { orgs } from "./orgs";

// A named labor rate. rate_cents_per_hour is integer cents/hr. Soft-delete via deleted_at; the
// use-case guards a "≥1 active rate" invariant (matches the prototype).
export const laborRates = pgTable(
  "labor_rates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    rateCentsPerHour: integer("rate_cents_per_hour").notNull().default(0),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("labor_rates_org_deleted_idx").on(t.orgId, t.deletedAt)],
);
