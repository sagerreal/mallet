import { pgTable, uuid, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { orgs } from "./orgs";

// THE ORG'S TAG VOCABULARY — the selectable labels offered by the customer Tags picker
// ("Google", "Referral", "Commercial", …). Ordered, soft-deleteable.
//
// The table name is historical: these were "lead sources" when a customer could carry exactly one.
// They are now the tag vocabulary, chosen labels land in `leads.tags`, and `leads.source` is an
// UNRELATED machine-written provenance column (see the note on it). The physical name is kept
// because the live DB is shared dev/prod and renames are not additive; the concept is tags.
//
// Removing a row takes away the CHOICE, not the history: customers already carrying the label keep
// it in `leads.tags`, which is why the picker's remove asks nothing first.
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
