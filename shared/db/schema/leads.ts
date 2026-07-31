import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  index,
  uniqueIndex,
  unique,
  check,
  foreignKey, jsonb } from "drizzle-orm/pg-core";
import { orgs } from "./orgs";
import { companies } from "./companies";

// A customer/lead in the pipeline. Every row carries org_id; RLS isolates by it.
// Conventions: money as integer cents, soft-delete, created/updated timestamps.
export const leads = pgTable(
  "leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    phoneE164: text("phone_e164"),
    email: text("email"),
    source: text("source"),
    stage: text("stage").notNull().default("new"),
    valueCents: integer("value_cents").notNull().default(0),
    unread: boolean("unread").notNull().default(false),
    // Free-form notes captured at lead creation or edited on the lead modal.
    // Nullable: most leads are created without notes.
    notes: text("notes"),
    // Service address captured at lead creation or updated from the lead modal.
    // Nullable: most leads are created without an address.
    address: text("address"),
    wonAt: timestamp("won_at", { withTimezone: true }),
    // B2B link: the company this contact works for (nullable — individual contacts have no company).
    companyId: uuid("company_id"),
    // Office-defined extra fields for this customer ({label, value} pairs, order preserved).
    // jsonb blob, not a table: these are display-only facts (gate codes, preferred entry),
    // never queried/joined — the office reads them with the customer open.
    customFields: jsonb("custom_fields"),
    // The contact's role at the company (e.g. "Property manager", "Owner"). Nullable.
    role: text("role"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    // Keyset pagination index: list a tenant's leads newest-first without OFFSET.
    index("leads_org_created_idx").on(t.orgId, t.createdAt.desc(), t.id.desc()),
    // Sort indexes — one per named sort in lead-sorts.ts. Column order mirrors the ORDER BY
    // exactly (org, sort column, id tiebreaker); an index the planner will not choose is worse
    // than none because it looks solved and is not.
    index("leads_org_updated_idx").on(t.orgId, t.updatedAt.desc(), t.id.desc()),
    index("leads_org_name_idx").on(t.orgId, t.name, t.id),
    index("leads_org_value_idx").on(t.orgId, t.valueCents.desc(), t.id.desc()),
    // Partial keyset index: same order but only over non-deleted rows (active-list query perf).
    index("leads_org_created_active_idx")
      .on(t.orgId, t.createdAt.desc(), t.id.desc())
      .where(sql`${t.deletedAt} is null`),
    // Dedupe customers by phone within an org (ignoring soft-deleted rows).
    uniqueIndex("leads_org_phone_uidx")
      .on(t.orgId, t.phoneE164)
      .where(sql`${t.deletedAt} is null and ${t.phoneE164} is not null`),
    // Make invalid pipeline stages unrepresentable at the storage layer.
    check("leads_stage_check", sql`${t.stage} in ('new', 'contacted', 'quote_sent', 'won', 'lost')`),
    // Composite-unique target so child tables (e.g. estimates) can FK on (org_id, id) and thereby
    // never link across tenants.
    unique("leads_org_id_uq").on(t.orgId, t.id),
    // Composite FK (org_id, company_id) → companies(org_id, id): prevents cross-tenant lead→company
    // links. The target is the composite unique "companies_org_id_uq" on companies(org_id, id).
    foreignKey({
      name: "leads_org_company_fk",
      columns: [t.orgId, t.companyId],
      foreignColumns: [companies.orgId, companies.id],
    }),
  ],
);
