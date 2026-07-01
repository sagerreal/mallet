import { pgTable, uuid, text, jsonb, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { orgs } from "./orgs";

// Server-enforced propose→confirm gate for MUTATING tools on the remote MCP surface (ADR 0007).
// A first call to a mutating tool mints a row here (args FROZEN at proposal time) and returns a
// one-time token; only a second call presenting that token executes — with the STORED args, so what
// was summarized is exactly what runs. The raw token (mallet_confirm_…) is shown once and never
// stored — only its SHA-256 hash. consumed_at set atomically on use (single-use); expires_at bounds
// the window. Always accessed inside withTenant, so RLS confines a token to its own org even if the
// raw value leaks across tenants.
export const toolConfirmations = pgTable(
  "tool_confirmations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    tool: text("tool").notNull(),
    args: jsonb("args").notNull(),
    summary: text("summary").notNull(),
    // Entity-state snapshot at propose time (tool.fingerprint); re-checked at confirm so a proposal
    // can't execute against a record that changed after the human read the summary.
    fingerprint: text("fingerprint"),
    // The api_keys id (Principal userId) that proposed the call — audit trail, not an auth gate.
    createdBy: uuid("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("tool_confirmations_token_hash_uidx").on(t.tokenHash),
    index("tool_confirmations_org_idx").on(t.orgId),
    // For future housekeeping (pruning expired/consumed rows).
    index("tool_confirmations_expires_idx").on(t.expiresAt),
  ],
);
