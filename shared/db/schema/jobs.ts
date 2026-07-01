import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  index,
  uniqueIndex,
  unique,
  check,
  foreignKey,
} from "drizzle-orm/pg-core";
import { orgs } from "./orgs";
import { leads } from "./leads";
import { estimates } from "./estimates";
import { users } from "./users";

// Scheduled field work. Optionally sourced from an accepted estimate (idempotent one-job-per-
// estimate). All tenant references are COMPOSITE FKs (org_id, ref_id) so a job can never point at
// another tenant's lead/estimate/user. Money is an integer-cent snapshot from the estimate.
export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    num: text("num").notNull(),
    leadId: uuid("lead_id").notNull(),
    sourceEstimateId: uuid("source_estimate_id"),
    assigneeUserId: uuid("assignee_user_id"),
    title: text("title"),
    status: text("status").notNull().default("scheduled"),
    scheduledStart: timestamp("scheduled_start", { withTimezone: true }),
    scheduledEnd: timestamp("scheduled_end", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),
    totalCents: integer("total_cents").notNull().default(0),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    // Composite-unique target for future child tables (visits), mirroring estimates_org_id_uq.
    unique("jobs_org_id_uq").on(t.orgId, t.id),
    // Tenant-safe references: the referenced row must share this job's org.
    foreignKey({
      name: "jobs_lead_fk",
      columns: [t.orgId, t.leadId],
      foreignColumns: [leads.orgId, leads.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "jobs_source_estimate_fk",
      columns: [t.orgId, t.sourceEstimateId],
      foreignColumns: [estimates.orgId, estimates.id],
    }),
    foreignKey({
      name: "jobs_assignee_fk",
      columns: [t.orgId, t.assigneeUserId],
      foreignColumns: [users.orgId, users.id],
    }),
    index("jobs_org_created_idx").on(t.orgId, t.createdAt.desc(), t.id.desc()),
    index("jobs_org_status_idx").on(t.orgId, t.status),
    index("jobs_org_lead_idx").on(t.orgId, t.leadId),
    index("jobs_org_assignee_idx").on(t.orgId, t.assigneeUserId),
    uniqueIndex("jobs_org_num_uidx")
      .on(t.orgId, t.num)
      .where(sql`${t.deletedAt} is null`),
    // One active job per accepted estimate — the idempotency backstop for createFromEstimate.
    uniqueIndex("jobs_org_source_estimate_uidx")
      .on(t.orgId, t.sourceEstimateId)
      .where(sql`${t.sourceEstimateId} is not null and ${t.deletedAt} is null`),
    check("jobs_status_check", sql`${t.status} in ('scheduled', 'in_progress', 'complete', 'canceled')`),
    check("jobs_total_check", sql`${t.totalCents} >= 0`),
    check(
      "jobs_window_check",
      sql`${t.scheduledEnd} is null or ${t.scheduledStart} is null or ${t.scheduledEnd} >= ${t.scheduledStart}`,
    ),
  ],
);
