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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One app user per Supabase auth identity — the lookup key for principal resolution.
    uniqueIndex("users_auth_user_uidx").on(t.authUserId),
    index("users_org_idx").on(t.orgId),
    check("users_role_check", sql`${t.role} in ('owner', 'office', 'tech')`),
    // Composite-unique target so child tables (e.g. jobs.assignee_user_id) can FK on (org_id, id)
    // and never point at another org's user.
    unique("users_org_id_uq").on(t.orgId, t.id),
  ],
);
