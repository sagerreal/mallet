import { pgTable, uuid, text, integer, timestamp, index, unique } from "drizzle-orm/pg-core";
import { orgs } from "./orgs";

/**
 * A shop-defined pipeline stage ("Adjuster meeting", "Follow-up 2"). Ordered, soft-deleteable.
 *
 * Stages are MANUAL by design — the shop names them, orders them, and drags customers between
 * them. This is deliberately the opposite contract from the derived "where they are" views
 * (modules/customers/infra/lead-views.ts), which are computed from facts and cannot lie. The two
 * coexist: the board's columns are the shop's, and every card still carries its derived fact, so
 * reality stays printed on the card even when the column is an intention.
 *
 * A lead points here via leads.pipeline_stage_id. Stage rows are never hard-deleted (soft-delete
 * house rule), so that FK never dangles — a lead pointing at a soft-deleted stage simply renders
 * as unstaged at query time.
 */
export const pipelineStages = pgTable(
  "pipeline_stages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    // The board lists live stages in order — this is that read.
    index("pipeline_stages_org_deleted_idx").on(t.orgId, t.deletedAt),
    // Composite target for leads' cross-tenant-proof FK, same device as companies_org_id_uq.
    unique("pipeline_stages_org_id_uq").on(t.orgId, t.id),
  ],
);
