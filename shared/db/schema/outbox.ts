import { sql } from "drizzle-orm";
import { pgTable, uuid, text, jsonb, timestamp, integer, bigserial, index } from "drizzle-orm/pg-core";
import { orgs } from "./orgs";

// Transactional outbox: a domain event is written here IN THE SAME TX as the state change that
// produced it (via OutboxEventBus), so an event is never lost on a crash and never emitted for a
// rolled-back operation. A background relay drains unpublished rows and dispatches each under
// withTenant(org_id). The WRITE path is RLS-scoped (org_id = current_org_id()); the relay reads via
// the owner connection (a trusted system process, not a tenant request) and re-scopes per row.
export const outbox = pgTable(
  "outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Monotonic insert order. now()/created_at is transaction_timestamp() — CONSTANT within a tx —
    // and the id is a random UUID, so neither can order two events emitted in the same tx (e.g.
    // invoice.payment.recorded then invoice.paid). A sequence advances once per row, giving the relay
    // a strict total order to dispatch by. Assigned by the DB on insert.
    seq: bigserial("seq", { mode: "number" }).notNull(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    eventName: text("event_name").notNull(),
    payload: jsonb("payload").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // null = unpublished. The relay stamps this after a successful dispatch.
    publishedAt: timestamp("published_at", { withTimezone: true }),
    // Relay bookkeeping. last_error stores only a SAFE discriminator (never provider PII/free text).
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
  },
  (t) => [
    // The relay's poll: oldest unpublished first, ordered by the monotonic seq (a strict total order,
    // unlike the tx-constant created_at). Partial index keeps it small as published rows pile up.
    index("outbox_unpublished_idx")
      .on(t.seq)
      .where(sql`${t.publishedAt} is null`),
    index("outbox_org_idx").on(t.orgId),
  ],
);
