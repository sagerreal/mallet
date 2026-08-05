import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
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
    // When the tech tapped "On my way". A STAMP, not a fifth status value: adding one would touch
    // the check constraint, the transition matrix, the job-status derivation and the DTO enum, for
    // a fact that is purely informational. Enroute is derived as (status = pending AND this set).
    enrouteAt: timestamp("enroute_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),
    totalCents: integer("total_cents").notNull().default(0),
    // The tax split of `total_cents`, snapshotted from the accepted estimate alongside it.
    // `total_cents` is tax-INCLUSIVE (estimate.ts: total = net + tax), so these record how much of
    // it was tax rather than adding to it — nothing downstream re-derives a total from them.
    taxBps: integer("tax_bps").notNull().default(0),
    taxCents: integer("tax_cents").notNull().default(0),
    /**
     * The discount rate agreed on the quote this job was sold from, carried forward.
     *
     * Not decoration. `total_cents` is discount-APPLIED and tax-inclusive, but the job's LINES are
     * neither — they are the pre-tax, pre-discount scope. The invoice prefers the lines (the
     * snapshot goes stale the moment a tech re-prices on site), so without the rate here the bill
     * re-summed the lines and charged the customer the undiscounted figure. Carried, never
     * re-derived: the discount is a term of the sale, not a property of the line set.
     */
    discBps: integer("disc_bps").notNull().default(0),
    notes: text("notes"),
    // The address the crew drives to, when it differs from the customer's on file — a property
    // manager's own address is not the unit being serviced. Both this and `phone` were accepted by
    // the create input and DROPPED for want of a column, so the office job modal's rows edited
    // nothing and the next jobs.list refetch erased what was typed.
    addr: text("addr"),
    phone: text("phone"),
    // What the tech did, in their words — "goes on the invoice the customer sees". Same fate as
    // addr: typed into the close-out sheet, dropped on the way to the server.
    completion: text("completion"),
    // The tech tapped "send to office": this job is ready to bill. Was a store-only flag, so the
    // office's ready-to-bill signal did not survive the tech's own page refresh.
    invRequested: boolean("inv_requested").notNull().default(false),
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
    // Cert requirement resolved from the booking-playbook service at voice-booking time.
    // Null = no requirement (most jobs). Set by the AI front desk's book_visit tool via
    // resolveServiceRequirement; office-created and estimate-sourced jobs leave this null.
    requiredCerts: text("required_certs").array(),
    /**
     * On-glass signature: the customer approving a price at their kitchen table, on the tech's
     * device. Mirrors the columns on `estimates` so one SignatureRecord renders both.
     *
     * The evidence is WEAKER here than on the web path, and the difference is worth writing down
     * rather than papering over. On /q/<token> the IP and user agent belong to the customer's own
     * phone, reached through a link only they were sent. Here they belong to the TECH's tablet, so
     * they attest to which device took the signature, not to who held it — what carries weight
     * in person is the tech standing there, the typed name, and the frozen price.
     *
     * All nullable: most jobs are never signed on site.
     */
    signerName: text("signer_name"),
    signatureSvg: text("signature_svg"),
    signerIp: text("signer_ip"),
    signerUserAgent: text("signer_user_agent"),
    signedAt: timestamp("signed_at", { withTimezone: true }),
    /** The lines and total exactly as shown when signed — see SignedSnapshot in quoting. */
    signedSnapshot: jsonb("signed_snapshot"),
    /** The staff member whose device took the signature — the in-person witness. */
    signedByUserId: uuid("signed_by_user_id"),
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
    // Sort indexes. Each named sort in job-sorts.ts needs one of these or the query degrades to a
    // sequential scan over the whole tenant — invisible at 1,500 jobs, a timeout at 40,000.
    // Column order mirrors the ORDER BY exactly (sort column, then id as the tiebreaker), because
    // an index the planner will not choose is worse than none: it looks solved and is not.
    index("jobs_org_scheduled_idx").on(t.orgId, t.scheduledStart.desc(), t.id.desc()),
    index("jobs_org_total_idx").on(t.orgId, t.totalCents.desc(), t.id.desc()),
    // The common combination: a status filter with the default scheduled sort.
    index("jobs_org_status_scheduled_idx").on(t.orgId, t.status, t.scheduledStart.desc()),
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
    check("jobs_tax_bps_check", sql`${t.taxBps} >= 0`),
    check("jobs_tax_cents_check", sql`${t.taxCents} >= 0`),
    check("jobs_disc_bps_check", sql`${t.discBps} between 0 and 10000`),
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
    // When the tech tapped "On my way". A STAMP, not a fifth status value: adding one would touch
    // the check constraint, the transition matrix, the job-status derivation and the DTO enum, for
    // a fact that is purely informational. Enroute is derived as (status = pending AND this set).
    enrouteAt: timestamp("enroute_at", { withTimezone: true }),
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
