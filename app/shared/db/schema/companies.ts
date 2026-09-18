import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { orgs } from "./orgs";

// A B2B company account. Every row carries org_id; RLS isolates by it (hand-written migration).
// Soft-delete via deletedAt; archived companies are excluded from the active list but kept for
// audit. The composite unique (org_id, id) enables composite FKs from leads (and future tables)
// that want to guarantee cross-tenant link safety.
export const companies = pgTable(
  "companies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    phone: text("phone"),
    email: text("email"),
    website: text("website"),
    address: text("address"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    // Composite-unique target so leads (and future tables) can FK on (org_id, id) and thereby
    // never link across tenants — the same pattern as leads_org_id_uq on the leads table.
    unique("companies_org_id_uq").on(t.orgId, t.id),
    // Primary query pattern: all non-deleted companies for an org, ordered newest-first.
    index("companies_org_deleted_idx").on(t.orgId, t.deletedAt),
  ],
);
