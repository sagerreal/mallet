import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
  foreignKey,
  primaryKey,
} from "drizzle-orm/pg-core";
import { orgs } from "./orgs";
import { leads } from "./leads";

// One row per answered call. Transcript/messages come from Vapi's end-of-call-report;
// disposition is derived from the call's tool invocations at record time.
export const frontdeskCalls = pgTable(
  "frontdesk_calls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => orgs.id),
    // Nullable FK: a caller may hang up before a lead is matched or created.
    leadId: uuid("lead_id"),
    vapiCallId: text("vapi_call_id").notNull(),
    fromNumber: text("from_number").notNull(),
    toNumber: text("to_number").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    endedReason: text("ended_reason"),
    transcript: text("transcript"),
    messages: jsonb("messages"), // [{role, message}] from artifact.messages
    recordingUrl: text("recording_url"),
    summary: text("summary"),
    disposition: text("disposition").notNull().default("no_action"),
    priceAudit: jsonb("price_audit"), // { flagged: string[] } — non-empty = violation
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("frontdesk_calls_vapi_call_uidx").on(t.orgId, t.vapiCallId),
    index("frontdesk_calls_lead_idx").on(t.orgId, t.leadId),
    // Composite FK (org_id, lead_id) → leads(org_id, id): prevents cross-tenant call→lead links.
    foreignKey({
      name: "frontdesk_calls_org_lead_fk",
      columns: [t.orgId, t.leadId],
      foreignColumns: [leads.orgId, leads.id],
    }),
  ],
);

// Idempotency ledger: Vapi retries tool webhooks; a replayed toolCallId returns the
// stored result and never re-executes (double-booking guard).
export const frontdeskToolInvocations = pgTable(
  "frontdesk_tool_invocations",
  {
    orgId: uuid("org_id").notNull().references(() => orgs.id),
    vapiCallId: text("vapi_call_id").notNull(),
    toolCallId: text("tool_call_id").notNull(),
    tool: text("tool").notNull(),
    result: jsonb("result").notNull(), // the exact ToolResult returned to Vapi
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.toolCallId] })],
);
