import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
  uniqueIndex,
  foreignKey,
  check,
} from "drizzle-orm/pg-core";
import { orgs } from "./orgs";
import { leads } from "./leads";
import { users } from "./users";

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
    // WHO sent an outbound message — the staffer behind the shared business number. Null for
    // inbound rows, system sends (reminders, OMW, front desk) and all history before this
    // column existed. The office reads this as "sent by Dana" on the thread.
    sentByUserId: uuid("sent_by_user_id"),
    // Tracks Twilio delivery lifecycle. 'queued' → 'sent' → 'delivered' | 'failed' | 'received'.
    status: text("status").notNull().default("queued"),
    // Why a message failed, as the CARRIER reported it (Twilio's numeric code, e.g. "30034" for a
    // number not registered for A2P). Kept because "sent" alone cannot distinguish a text that
    // landed from one the carrier silently dropped — which is the whole reason this column exists.
    errorCode: text("error_code"),
    // When the carrier last told us anything. Null until a status callback arrives, which is also
    // how a message sent before this existed stays honestly unknown rather than claiming delivery.
    statusAt: timestamp("status_at", { withTimezone: true }),
    // The caller's dedupe token for an outbound send, claimed BEFORE the provider call (see
    // SendMessageUseCase). Nullable: inbound messages and pre-existing rows have none, and the
    // unique index below is partial so they stay unconstrained.
    idempotencyKey: text("idempotency_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    // Primary read: all messages in a thread (org+lead), newest-first.
    index("messages_org_lead_created_idx").on(t.orgId, t.leadId, t.createdAt),
    // Secondary: all org messages for ops/audit.
    index("messages_org_created_idx").on(t.orgId, t.createdAt),
    // Dedupe outbound sends on (org_id, idempotency_key) — the claim the send use-case takes
    // before it calls Twilio, so a double-click cannot text a customer twice. Partial, like
    // orgs_twilio_number_uidx: rows without a key (every inbound message) are unconstrained.
    uniqueIndex("messages_org_idem_uidx")
      .on(t.orgId, t.idempotencyKey)
      .where(sql`${t.idempotencyKey} is not null`),
    // Composite FK (org_id, lead_id) → leads(org_id, id): prevents cross-tenant message→lead links.
    foreignKey({
      name: "messages_org_lead_fk",
      columns: [t.orgId, t.leadId],
      foreignColumns: [leads.orgId, leads.id],
    }),
    // Tenant-safe sender: the attributed staffer must share this message's org (mirrors
    // jobs_assignee_fk).
    foreignKey({
      name: "messages_org_sender_fk",
      columns: [t.orgId, t.sentByUserId],
      foreignColumns: [users.orgId, users.id],
    }),
    // Reject unknown directions and statuses at the storage layer.
    check("messages_direction_check", sql`${t.direction} in ('inbound', 'outbound')`),
    check(
      "messages_status_check",
      sql`${t.status} in ('queued', 'sent', 'delivered', 'failed', 'received')`,
    ),
  ],
);
