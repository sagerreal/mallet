import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  timestamp,
  index,
  unique,
  foreignKey,
  check,
} from "drizzle-orm/pg-core";
import { orgs } from "./orgs";

// A reusable checklist template the office attaches per job ("before you leave")
// or per estimate visit ("scope"). Header + ordered items (see checklist_items).
// RLS isolates by org_id (hand-written migration). Soft-delete via deletedAt.
export const checklistTemplates = pgTable(
  "checklist_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    trade: text("trade").notNull().default("Custom"),
    stage: text("stage").notNull().default("job"),
    // Fuzzy job-type match keywords (["water heater", "tankless"]); jsonb array of text.
    match: text("match").array().notNull().default(sql`ARRAY[]::text[]`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    // Composite-unique target so checklist_items can FK on (org_id, id) and never
    // link across tenants — same pattern as estimates_org_id_uq.
    unique("checklist_templates_org_id_uq").on(t.orgId, t.id),
    // Primary query: all non-deleted templates for an org, newest-first.
    index("checklist_templates_org_deleted_idx").on(t.orgId, t.deletedAt),
    check("checklist_templates_stage_check", sql`${t.stage} in ('job', 'scope')`),
  ],
);

// An ordered item on a checklist template. Composite FK (org_id, template_id)
// enforces intra-org containment (RI checks run owner-side, bypassing RLS — the
// composite key is what actually closes the cross-tenant hole).
export const checklistItems = pgTable(
  "checklist_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    templateId: uuid("template_id").notNull(),
    text: text("text").notNull(),
    type: text("type").notNull().default("check"),
    required: boolean("required").notNull().default(false),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({
      name: "checklist_items_template_fk",
      columns: [t.orgId, t.templateId],
      foreignColumns: [checklistTemplates.orgId, checklistTemplates.id],
    }).onDelete("cascade"),
    index("checklist_items_org_template_idx").on(t.orgId, t.templateId),
    check("checklist_items_type_check", sql`${t.type} in ('check', 'photo')`),
  ],
);
