import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
  foreignKey,
  check,
} from "drizzle-orm/pg-core";
import { orgs } from "./orgs";
import { leads } from "./leads";

// A two-way SMS (or future channel) message scoped to a tenant. Every row carries org_id; RLS
// isolates by it. leadId is nullable so inbound messages from unknown numbers are never dropped
// (they land with leadId=null and can be matched to a lead later).
export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    // Nullable FK: inbound from unknown number has no lead yet.
    leadId: uuid("lead_id"),
    direction: text("direction").notNull(), // 'inbound' | 'outbound'
    channel: text("channel").notNull().default("sms"),
    body: text("body").notNull(),
    // The E.164 number this message came from (org's Twilio number for outbound; customer number for inbound).
    fromNumber: text("from_number").notNull(),
    // The E.164 number this message was sent to.
    toNumber: text("to_number").notNull(),
    // Twilio MessageSid (SM...) — null until confirmed by the API response.
    providerSid: text("provider_sid"),
    // Tracks Twilio delivery lifecycle. 'queued' → 'sent' → 'delivered' | 'failed' | 'received'.
    status: text("status").notNull().default("queued"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    // Primary read: all messages in a thread (org+lead), newest-first.
    index("messages_org_lead_created_idx").on(t.orgId, t.leadId, t.createdAt),
    // Secondary: all org messages for ops/audit.
    index("messages_org_created_idx").on(t.orgId, t.createdAt),
    // Composite FK (org_id, lead_id) → leads(org_id, id): prevents cross-tenant message→lead links.
    foreignKey({
      name: "messages_org_lead_fk",
      columns: [t.orgId, t.leadId],
      foreignColumns: [leads.orgId, leads.id],
    }),
    // Reject unknown directions and statuses at the storage layer.
    check("messages_direction_check", sql`${t.direction} in ('inbound', 'outbound')`),
    check(
      "messages_status_check",
      sql`${t.status} in ('queued', 'sent', 'delivered', 'failed', 'received')`,
    ),
  ],
);
