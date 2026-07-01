import { sql } from "drizzle-orm";
import { pgTable, uuid, text, timestamp, uniqueIndex, index, check } from "drizzle-orm/pg-core";
import { orgs } from "./orgs";

// Per-tenant API keys for the remote MCP server (and future programmatic access). The raw key
// (mallet_sk_…) is shown ONCE at issue time and NEVER stored — only its SHA-256 hash. A key carries
// the role its bearer acts as; revoked_at soft-revokes. Resolved cross-tenant by hash via the
// SECURITY DEFINER app_resolve_api_key() (mirrors app_resolve_principal), so the least-privilege
// runtime role can look a key up without a BYPASSRLS connection.
export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    hashedKey: text("hashed_key").notNull(),
    role: text("role").notNull(),
    label: text("label"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("api_keys_hashed_key_uidx").on(t.hashedKey),
    index("api_keys_org_idx").on(t.orgId),
    check("api_keys_role_check", sql`${t.role} in ('owner', 'office', 'tech')`),
  ],
);
