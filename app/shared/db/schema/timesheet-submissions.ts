import { pgTable, uuid, date, timestamp, text, unique, foreignKey } from "drizzle-orm/pg-core";
import { users } from "./users";

// A technician's attestation that a week of hours is complete and correct — the state between
// draft entries and the office's approval (precedence: Approved > Submitted > Draft; approval
// lives on the ENTRIES via time_entries.status, deliberately not duplicated here).
//
// One row per (org, tech, week): the unique index makes submitWeek idempotent by construction —
// a replayed submit finds the row instead of minting a second attestation.
//
// `reopened_at` is the clock-outranks-submission rule: the punch clock never refuses, so hours
// landing AFTER a submit reopen it (with the reason) rather than being locked out. The tech
// re-submits; the office sees a reopened week as not-yet-attested.
//
// RLS is added by a hand-written migration (same model as time_entries) — drizzle never emits it.
export const timesheetSubmissions = pgTable(
  "timesheet_submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    techUserId: uuid("tech_user_id").notNull(),
    // Monday of the submitted week, YYYY-MM-DD — the same week grain approveWeek uses.
    weekStart: date("week_start").notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    reopenedAt: timestamp("reopened_at", { withTimezone: true }),
    reopenReason: text("reopen_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("timesheet_submissions_org_tech_week_uq").on(t.orgId, t.techUserId, t.weekStart),
    foreignKey({
      name: "timesheet_submissions_tech_fk",
      columns: [t.orgId, t.techUserId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete("cascade"),
  ],
);
