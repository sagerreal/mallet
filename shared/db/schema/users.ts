import { sql } from "drizzle-orm";
import { pgTable, uuid, text, timestamp, index, uniqueIndex, check } from "drizzle-orm/pg-core";
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
    role: text("role").notNull().default("owner"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One app user per Supabase auth identity — the lookup key for principal resolution.
    uniqueIndex("users_auth_user_uidx").on(t.authUserId),
    index("users_org_idx").on(t.orgId),
    check("users_role_check", sql`${t.role} in ('owner', 'office', 'tech')`),
  ],
);
