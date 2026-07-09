import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  date,
  time,
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

// A single scheduled visit on a job. Composite FK (org_id, job_id) enforces intra-org
// containment (mirrors estimate_lines). An unplaced visit has no date or assignee yet.
export const jobVisits = pgTable(
  "job_visits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    jobId: uuid("job_id").notNull(),
    assigneeUserId: uuid("assignee_user_id"), // nullable — unplaced
    scheduledDate: date("scheduled_date"), // nullable — no date yet; string "YYYY-MM-DD"
    scheduledStart: time("scheduled_start"), // nullable; string "HH:MM:SS"
    scheduledEnd: time("scheduled_end"), // nullable; string "HH:MM:SS"
    status: text("status").notNull().default("pending"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    notes: text("notes"),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    // Intra-org containment: a visit can only reference a job in its own org.
    foreignKey({
      name: "job_visits_job_fk",
      columns: [t.orgId, t.jobId],
      foreignColumns: [jobs.orgId, jobs.id],
    }).onDelete("cascade"),
    // Tenant-safe assignee: the referenced user must share this visit's org.
    foreignKey({
      name: "job_visits_assignee_fk",
      columns: [t.orgId, t.assigneeUserId],
      foreignColumns: [users.orgId, users.id],
    }),
    index("job_visits_org_job_idx").on(t.orgId, t.jobId),
    index("job_visits_org_assignee_date_idx").on(t.orgId, t.assigneeUserId, t.scheduledDate),
    check(
      "job_visits_status_check",
      sql`${t.status} in ('pending', 'in_progress', 'complete', 'canceled')`,
    ),
  ],
);
