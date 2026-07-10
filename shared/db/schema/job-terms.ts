import { pgTable, uuid, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { orgs } from "./orgs";

// A reusable terms/fine-print entry for quotes. title + body free text, ordered. Soft-delete.
export const jobTerms = pgTable(
  "job_terms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    body: text("body").notNull(),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("job_terms_org_deleted_idx").on(t.orgId, t.deletedAt)],
);
