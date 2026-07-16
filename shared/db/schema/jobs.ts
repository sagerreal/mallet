import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  date,
  time,
  jsonb,
  index,
  uniqueIndex,
  unique,
  check,
  foreignKey,
  doublePrecision,
} from "drizzle-orm/pg-core";
import { orgs } from "./orgs";
import { leads } from "./leads";
import { estimates } from "./estimates";
import { users } from "./users";

// Office-attached "before you leave" checklist SNAPSHOT (denormalized on purpose: the job
// carries its own copy so later edits to the source template never rewrite job history).
// Item order is the array order. Crew ANSWERS live in job_verify_answers, not here.
export interface JobChecklistColumn {
  name: string;
  items: { id: string; text: string; type: "check" | "photo"; required: boolean }[];
}

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
    // Service type ("service" | "estimate" | free-text trade label). Mirrors the store
    // Job.svc field; nullable because estimate-sourced jobs may not set one at creation.
    svc: text("svc"),
    // 'work' (sold/repair work) | 'estimate' (pre-quote scope visit booked as a job so it
    // rides the board/My-Day unchanged). Default keeps every existing row a work job.
    kind: text("kind").notNull().default("work"),
    // Optional before-you-leave checklist attached by the office (see JobChecklistColumn).
    // Nullable: most jobs have none.
    checklist: jsonb("checklist").$type<JobChecklistColumn>(),
    // Free-text "anything else noticed?" note captured during the booking flow (AI front desk).
    // Nullable — office-created jobs have none; only set when a caller volunteered context.
    scope: text("scope"),
    // Callback link: this job is a redo/follow-on of an earlier job in the same org.
    // Nullable — most jobs are not callbacks. callbackOf is the id of the original job;
    // callbackReason categorises why (see CallbackReason domain type).
    callbackOf: uuid("callback_of"),
    callbackReason: text("callback_reason"),
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
    // Self-referential composite FK: the callback target must be in the same org.
    foreignKey({
      name: "jobs_callback_of_fk",
      columns: [t.orgId, t.callbackOf],
      foreignColumns: [t.orgId, t.id],
    }),
    check("jobs_status_check", sql`${t.status} in ('scheduled', 'in_progress', 'complete', 'canceled')`),
    check("jobs_kind_check", sql`${t.kind} in ('work', 'estimate')`),
    check(
      "jobs_callback_reason_check",
      sql`${t.callbackReason} is null or ${t.callbackReason} in ('callback', 'new_issue', 'found_work')`,
    ),
    check("jobs_total_check", sql`${t.totalCents} >= 0`),
    check(
      "jobs_window_check",
      sql`${t.scheduledEnd} is null or ${t.scheduledStart} is null or ${t.scheduledEnd} >= ${t.scheduledStart}`,
    ),
    check(
      "jobs_svc_len_check",
      sql`${t.svc} is null or (char_length(btrim(${t.svc})) between 1 and 60)`,
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
    // Authoritative visit length in minutes (set by create/updateDuration/schedule use-cases).
    // Nullable: legacy rows fall back to the start→end window at the mapper read boundary.
    durationMinutes: integer("duration_minutes"),
    // Geocoded location of the visit's service address (WGS84). Nullable — office-created
    // and legacy visits have no point. Both columns are set together or not at all.
    lat: doublePrecision("lat"),   // nullable — the visit's geocoded latitude (WGS84), null when unknown
    lng: doublePrecision("lng"),   // nullable — the visit's geocoded longitude (WGS84), null when unknown
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
