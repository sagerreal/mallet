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
  check,
} from "drizzle-orm/pg-core";
import { orgs } from "./orgs";

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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    // Keyset pagination index: list a tenant's leads newest-first without OFFSET.
    index("leads_org_created_idx").on(t.orgId, t.createdAt.desc(), t.id.desc()),
    // Dedupe customers by phone within an org (ignoring soft-deleted rows).
    uniqueIndex("leads_org_phone_uidx")
      .on(t.orgId, t.phoneE164)
      .where(sql`${t.deletedAt} is null and ${t.phoneE164} is not null`),
    // Make invalid pipeline stages unrepresentable at the storage layer.
    check("leads_stage_check", sql`${t.stage} in ('new', 'contacted', 'quote_sent', 'won', 'lost')`),
  ],
);
