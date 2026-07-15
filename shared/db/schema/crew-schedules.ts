import { sql } from "drizzle-orm";
import { pgTable, uuid, integer, primaryKey, foreignKey, check } from "drizzle-orm/pg-core";
import { orgs } from "./orgs";
import { users } from "./users";

// Per-crew working hours: one row per (org, field-crew user, weekday) that a crew works. The slot
// math (Task 2.2) offers only windows a crew actually works, and dispatch (Task 2.3) balances by
// crew. A crew with NO row for a weekday falls back to the org's default hours (hoursWd/Sat/Sun) —
// that fallback is applied by the slot math, NOT stored here (this table holds only real overrides).
//
// weekday follows JS getDay(): 0 = Sunday .. 6 = Saturday. open_hour/close_hour are whole hours in
// [0, 24] (24 = end-of-day), matching org_settings' hours* convention. The (org_id, user_id)
// composite FK → users(org_id, id) mirrors jobs_assignee_fk: a schedule can never point at another
// org's user. PK (org_id, user_id, weekday) makes each crew-day unique.
export const crewSchedules = pgTable(
  "crew_schedules",
  {
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull(),
    weekday: integer("weekday").notNull(),
    openHour: integer("open_hour").notNull(),
    closeHour: integer("close_hour").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.userId, t.weekday] }),
    // Tenant-safe assignee: the referenced user must share this schedule's org (mirrors
    // jobs_assignee_fk → users(org_id, id)). Cascade so removing a user clears their schedule.
    foreignKey({
      name: "crew_schedules_user_fk",
      columns: [t.orgId, t.userId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete("cascade"),
    check("crew_schedules_weekday_check", sql`${t.weekday} >= 0 and ${t.weekday} <= 6`),
    check("crew_schedules_open_hour_check", sql`${t.openHour} >= 0 and ${t.openHour} <= 24`),
    check("crew_schedules_close_hour_check", sql`${t.closeHour} >= 0 and ${t.closeHour} <= 24`),
  ],
);
