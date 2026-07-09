import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  boolean,
  date,
  timestamp,
  index,
  foreignKey,
} from "drizzle-orm/pg-core";
import { orgs } from "./orgs";
import { leads } from "./leads";

// A task tied to an org (optionally to a lead). org_id carries RLS — added by hand-written
// migration, not Drizzle DDL. leadId is nullable so a task may stand alone.
export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    // Nullable FK: a task need not belong to any lead.
    leadId: uuid("lead_id"),
    text: text("text").notNull(),
    // Store as a date string (YYYY-MM-DD) — no time component needed.
    dueDate: date("due_date"),
    done: boolean("done").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    // Composite FK (org_id, lead_id) → leads(org_id, id): prevents cross-tenant task→lead links.
    // The target is the composite unique "leads_org_id_uq" on leads(org_id, id).
    foreignKey({
      name: "tasks_org_lead_fk",
      columns: [t.orgId, t.leadId],
      foreignColumns: [leads.orgId, leads.id],
    }),
    // Primary query pattern: all non-done tasks for an org ordered by due date.
    index("tasks_org_done_due_idx").on(t.orgId, t.done, t.dueDate),
  ],
);
