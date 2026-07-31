import { sql } from "drizzle-orm";
import { pgTable, uuid, text, boolean, timestamp, index, uniqueIndex, unique, check } from "drizzle-orm/pg-core";
import { orgs } from "./orgs";

// A member of an org. `auth_user_id` is the Supabase Auth user id (the JWT `sub`); it is the
// bridge from an authenticated session to a tenant + role. One org per user for the pilot —
// multi-org membership is deferred (YAGNI).
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    authUserId: uuid("auth_user_id").notNull(),
    email: text("email").notNull(),
    name: text("name"), // nullable — crew roster display name; existing rows/signup unaffected
    role: text("role").notNull().default("owner"),
    isFieldCrew: boolean("is_field_crew").notNull().default(false),
    // Certification tags for this tech (e.g. ["Gas", "Boiler"]). Additive column —
    // existing rows default to empty array. No new RLS needed (users table is FOR ALL).
    skillTags: text("skill_tags").array().notNull().default(sql`'{}'::text[]`),
    // The mobile Elas rings first on an outbound click-to-call, E.164. Additive + nullable:
    // existing rows are unaffected, and it is remembered the first time a call is placed so the
    // office does not retype it. No new RLS needed (users table is already FOR ALL).
    callbackNumber: text("callback_number"),
    // Set only when the number has PROVEN it belongs to this user — they texted a code back from
    // it. Until then callback_number is self-assertion: a logged-in user typing digits into a box,
    // with no OTP and no ownership proof. That is fine for "ring me at this number" (the worst case
    // is your own call goes to the wrong phone) and NOT fine as the identity behind an inbound
    // command channel, where it decides whose org an SMS may write to. The SMS agent matches on
    // this column being non-null; nothing else reads it, so the calling flow is unchanged.
    callbackVerifiedAt: timestamp("callback_verified_at", { withTimezone: true }),
    // Whether the AI front desk may put a caller through to this person when a call needs a human.
    //
    // Escalation was a SINGLE org-wide number, so a shop with three office staff had no way to say
    // "Sarah is on today". Who is actually reachable now comes from crew_schedules — the same
    // per-person hours the dispatch board already uses — so this is the only new fact: is this
    // person someone the front desk may interrupt at all.
    //
    // Defaults false: nobody's phone starts ringing because an upgrade shipped.
    takesCalls: boolean("takes_calls").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One app user per Supabase auth identity — the lookup key for principal resolution.
    uniqueIndex("users_auth_user_uidx").on(t.authUserId),
    index("users_org_idx").on(t.orgId),
    check("users_role_check", sql`${t.role} in ('owner', 'office', 'tech')`),
    // GLOBAL, not per-org, and that is the whole point. Every shop's staff texts ONE Elas-owned
    // assistant number, so the number a text arrived AT no longer says which shop it belongs to —
    // the SENDER's number is the only thing that identifies both the person and their org. Scoped
    // per-org this index would permit the same mobile in two shops, and an inbound text would have
    // no way to choose between them.
    //
    // Partial: only VERIFIED numbers are constrained, so the many NULLs and any unverified
    // duplicates stay legal and no existing row is invalidated.
    uniqueIndex("users_verified_callback_uidx")
      .on(t.callbackNumber)
      .where(sql`${t.callbackVerifiedAt} is not null`),
    // Composite-unique target so child tables (e.g. jobs.assignee_user_id) can FK on (org_id, id)
    // and never point at another org's user.
    unique("users_org_id_uq").on(t.orgId, t.id),
  ],
);
