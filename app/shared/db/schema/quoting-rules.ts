import { pgTable, uuid, text, integer, timestamp, index, check, foreignKey } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { orgs } from "./orgs";
import { pricebookItems } from "./pricebook-items";
import { estimates } from "./estimates";

// The shop's learned quoting rules — the CONDITIONAL layer of the estimator's
// memory. Service-general scalar corrections write back to the pricebook row
// itself (labor_hours etc.); this table holds only what a scalar can't:
// "add 2h when the house is pre-1980", "this county requires an expansion
// tank". Supersede-never-delete (invalidated_at + superseded_by) so history
// survives; provenance (author, source estimate, trigger) on every row.
// Status: 'confirmed' rules reach prompts; 'proposed' rules sit in the owner
// review queue (edit-delta mining and non-admin corrections land there).
// Deliberately NO category_id: rules match by service or job_tag keywords only
// (YAGNI — category scoping adds a join the matcher never uses).
export const quotingRules = pgTable(
  "quoting_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    // The rule itself — one human-readable sentence, ≤300 chars (domain-enforced).
    rule: text("rule").notNull(),
    // Optional scoping: a specific service, or a free-text job tag ("water heater").
    serviceId: uuid("service_id"),
    jobTag: text("job_tag"),
    status: text("status").notNull().default("proposed"),
    source: text("source").notNull().default("manual"),
    authorUserId: uuid("author_user_id"),
    sourceEstimateId: uuid("source_estimate_id"),
    timesConfirmed: integer("times_confirmed").notNull().default(1),
    validFrom: timestamp("valid_from", { withTimezone: true }).notNull().defaultNow(),
    invalidatedAt: timestamp("invalidated_at", { withTimezone: true }),
    supersededBy: uuid("superseded_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("quoting_rules_org_status_idx").on(t.orgId, t.status, t.invalidatedAt),
    check("quoting_rules_status_check", sql`${t.status} in ('proposed', 'confirmed')`),
    check("quoting_rules_source_check", sql`${t.source} in ('manual', 'refine', 'edit_delta')`),
    // Cross-tenant guards: a rule can only reference its own org's service/estimate.
    foreignKey({
      columns: [t.orgId, t.serviceId],
      foreignColumns: [pricebookItems.orgId, pricebookItems.id],
      name: "quoting_rules_service_fk",
    }),
    foreignKey({
      columns: [t.orgId, t.sourceEstimateId],
      foreignColumns: [estimates.orgId, estimates.id],
      name: "quoting_rules_estimate_fk",
    }),
  ],
);
