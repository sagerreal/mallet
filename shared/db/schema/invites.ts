import { sql } from "drizzle-orm";
import { pgTable, uuid, text, timestamp, index, check } from "drizzle-orm/pg-core";
import { orgs } from "./orgs";

// Pending / accepted / revoked invite for a not-yet-provisioned email address.
// The signup SECURITY DEFINER fn looks up pending invites by email (cross-org, bypasses RLS)
// at first-signup time so the invitee joins the inviting org instead of creating their own.
export const orgInvites = pgTable(
  "org_invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role").notNull(),
    status: text("status").notNull().default("pending"),
    invitedByUserId: uuid("invited_by_user_id"), // nullable — references users(id) but not FK-enforced (cross-tenant)
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  },
  (t) => [
    // RLS-aligned lookup: owner/office query their own org's invites
    index("org_invites_org_status_idx").on(t.orgId, t.status),
    // Signup lookup: find a pending invite for a given email (cross-org inside SECURITY DEFINER)
    index("org_invites_org_email_idx").on(t.orgId, t.email),
    check("org_invites_role_check", sql`${t.role} in ('owner', 'office', 'tech')`),
    check("org_invites_status_check", sql`${t.status} in ('pending', 'accepted', 'revoked')`),
  ],
);
