import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  boolean,
  date,
  time,
  integer,
  timestamp,
  index,
  unique,
  check,
  foreignKey,
} from "drizzle-orm/pg-core";
import { jobs } from "./jobs";
import { users } from "./users";

// Time entries for field technicians. Tenant isolation enforced via org_id in every row.
// RLS is added by a hand-written migration (0036_time_entries_rls.sql) — same model as tasks.
export const timeEntries = pgTable(
  "time_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    techUserId: uuid("tech_user_id").notNull(),
    jobId: uuid("job_id"), // nullable — e.g. travel/break/shop not tied to a specific job
    workDate: date("work_date").notNull(),
    kind: text("kind").notNull(),
    // Nullable since the time-off kinds landed: a PTO day has no punch times, only `minutes`.
    // Clock kinds still require it — the shape check below is the real guard.
    startTime: time("start_time"),
    endTime: time("end_time"), // nullable — running timer has no endTime yet
    // Time-off length. Present exactly when the kind is a time-off kind; clock kinds derive
    // their length from the punch times and must leave this null.
    minutes: integer("minutes"),
    note: text("note").notNull().default(""),
    src: text("src").notNull().default("manual"),
    status: text("status").notNull().default("draft"),
    running: boolean("running").notNull().default(false),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    // WHO last hand-edited a payroll row (null = untouched tap-truth). Review needs to tell
    // tap-truth from thumb-truth, and whose thumb — set on every manual create/update.
    editedByUserId: uuid("edited_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    // Composite-unique target so child tables could FK on (org_id, id).
    unique("time_entries_org_id_uq").on(t.orgId, t.id),
    // Composite FK: the tech user must live in this entry's org.
    foreignKey({
      name: "time_entries_tech_user_fk",
      columns: [t.orgId, t.techUserId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete("cascade"),
    // Composite FK: the job must live in this entry's org (nullable — enforced by DB only when
    // jobId is not null; Drizzle doesn't need a separate partial index for this).
    foreignKey({
      name: "time_entries_job_fk",
      columns: [t.orgId, t.jobId],
      foreignColumns: [jobs.orgId, jobs.id],
    }),
    // Primary query pattern: a tech's week view.
    index("time_entries_org_tech_date_idx").on(t.orgId, t.techUserId, t.workDate),
    // Manager approval queue.
    index("time_entries_org_status_idx").on(t.orgId, t.status),
    check(
      "time_entries_kind_check",
      sql`${t.kind} in ('job', 'travel', 'break', 'shop', 'pto', 'vacation', 'sick', 'holiday')`,
    ),
    // The kind decides the SHAPE: clock kinds carry punch times and never minutes; time-off
    // kinds carry minutes (up to one day) and never punch times, and can never be "running".
    check(
      "time_entries_kind_shape_check",
      sql`(${t.kind} in ('job', 'travel', 'break', 'shop') and ${t.startTime} is not null and ${t.minutes} is null)
          or (${t.kind} in ('pto', 'vacation', 'sick', 'holiday') and ${t.startTime} is null and ${t.endTime} is null and ${t.minutes} between 1 and 1440 and ${t.running} = false)`,
    ),
    check("time_entries_src_check", sql`${t.src} in ('manual', 'clock', 'timer')`),
    check("time_entries_status_check", sql`${t.status} in ('draft', 'approved')`),
  ],
);
