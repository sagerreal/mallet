import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  integer,
  numeric,
  boolean,
  timestamp,
  index,
  unique,
  check,
  foreignKey,
} from "drizzle-orm/pg-core";
// Tenant safety comes from the composite FK to jobs (org_id, job_id) → jobs_org_id_uq,
// and jobs.org_id already FKs to orgs — so no direct orgs FK is needed here.
import { jobs } from "./jobs";

// Job execution data — the field-captured tail of a job. Every table carries its own org_id
// (stamped on insert) and is isolated independently by RLS (same model as job_visits, migration
// 0026). Composite FK (org_id, job_id) → jobs(org_id, id) so a child can never point at another
// tenant's job. Money is integer cents; quantities mirror estimate_lines' numeric(12,2).

// Billable job line items (the tech's line edits on the job, distinct from the estimate snapshot).
export const jobLines = pgTable(
  "job_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    jobId: uuid("job_id").notNull(),
    description: text("description").notNull(),
    quantity: numeric("quantity", { precision: 12, scale: 2, mode: "number" }).notNull().default(1),
    rateCents: integer("rate_cents").notNull().default(0),
    costCents: integer("cost_cents").notNull().default(0),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({
      name: "job_lines_job_fk",
      columns: [t.orgId, t.jobId],
      foreignColumns: [jobs.orgId, jobs.id],
    }).onDelete("cascade"),
    index("job_lines_org_job_idx").on(t.orgId, t.jobId),
    check("job_lines_qty_check", sql`${t.quantity} >= 0`),
    check("job_lines_rate_check", sql`${t.rateCents} >= 0`),
    check("job_lines_cost_check", sql`${t.costCents} >= 0`),
  ],
);

// Found-work add-ons discovered on site. status: proposed → approved | declined. invoiceSkip keeps
// an approved add-on off the current bill while leaving it on the job.
export const jobAddons = pgTable(
  "job_addons",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    jobId: uuid("job_id").notNull(),
    description: text("description").notNull(),
    quantity: numeric("quantity", { precision: 12, scale: 2, mode: "number" }).notNull().default(1),
    rateCents: integer("rate_cents").notNull().default(0),
    costCents: integer("cost_cents").notNull().default(0),
    isOptional: boolean("is_optional").notNull().default(false),
    invoiceSkip: boolean("invoice_skip").notNull().default(false),
    status: text("status").notNull().default("proposed"),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({
      name: "job_addons_job_fk",
      columns: [t.orgId, t.jobId],
      foreignColumns: [jobs.orgId, jobs.id],
    }).onDelete("cascade"),
    index("job_addons_org_job_idx").on(t.orgId, t.jobId),
    check("job_addons_qty_check", sql`${t.quantity} >= 0`),
    check("job_addons_rate_check", sql`${t.rateCents} >= 0`),
    check("job_addons_cost_check", sql`${t.costCents} >= 0`),
    check("job_addons_status_check", sql`${t.status} in ('proposed', 'approved', 'declined')`),
  ],
);

// One before-you-leave checklist answer per (job, checklist item). Upsert-keyed on
// (org_id, job_id, item_id) so re-answering replaces; unchecking deletes the single row. state:
// pass (checked, via manual|photo) | override (N/A with reason). item_id is the store's numeric
// checklist item id (stable per checklist template).
export const jobVerifyAnswers = pgTable(
  "job_verify_answers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    jobId: uuid("job_id").notNull(),
    itemId: integer("item_id").notNull(),
    state: text("state").notNull(),
    via: text("via"),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "job_verify_answers_job_fk",
      columns: [t.orgId, t.jobId],
      foreignColumns: [jobs.orgId, jobs.id],
    }).onDelete("cascade"),
    // One answer per checklist item per job — the upsert conflict target.
    unique("job_verify_answers_item_uq").on(t.orgId, t.jobId, t.itemId),
    index("job_verify_answers_org_job_idx").on(t.orgId, t.jobId),
    check("job_verify_answers_state_check", sql`${t.state} in ('pass', 'override')`),
  ],
);

// A field photo. storagePath is the org-prefixed key inside the private 'job-photos' bucket
// (<org_id>/<job_id>/<uuid>.<ext>). verifyPass true when the upload auto-passed the next photo
// checklist item (mirrors addJobPhoto's auto-pass). caption is optional free text.
export const jobPhotos = pgTable(
  "job_photos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    jobId: uuid("job_id").notNull(),
    storagePath: text("storage_path").notNull(),
    caption: text("caption"),
    verifyPass: boolean("verify_pass").notNull().default(false),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({
      name: "job_photos_job_fk",
      columns: [t.orgId, t.jobId],
      foreignColumns: [jobs.orgId, jobs.id],
    }).onDelete("cascade"),
    // A storage path is written once per org — dedup guard against a double-record on retry.
    unique("job_photos_org_path_uq").on(t.orgId, t.storagePath),
    index("job_photos_org_job_idx").on(t.orgId, t.jobId),
  ],
);
