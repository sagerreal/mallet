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
  foreignKey,
} from "drizzle-orm/pg-core";
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
    unread: boolean("unread").notNull().default(true),
    wonAt: timestamp("won_at", { withTimezone: true }),
    // B2B link: the company this contact works for (nullable — individual contacts have no company).
    companyId: uuid("company_id"),
    // The contact's role at the company (e.g. "Property manager", "Owner"). Nullable.
    role: text("role"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    // Keyset pagination index: list a tenant's leads newest-first without OFFSET.
    index("leads_org_created_idx").on(t.orgId, t.createdAt.desc(), t.id.desc()),
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
