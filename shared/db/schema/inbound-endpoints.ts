import { pgTable, uuid, text, timestamp, unique, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { orgs } from "./orgs";

// A place outside a phone call that can drop leads into an org's pipeline: the website form,
// or a marketplace webhook (Angi/Thumbtack). One row per (org, channel). The token is the
// unguessable credential in the public URL (64 hex / 256-bit). "Connected" = last_lead_at set.
export const inboundEndpoints = pgTable(
  "inbound_endpoints",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    channel: text("channel").notNull(),
    token: text("token").notNull(),
    lastLeadAt: timestamp("last_lead_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    unique("inbound_endpoints_org_channel_uq").on(t.orgId, t.channel),
    unique("inbound_endpoints_token_uq").on(t.token), // hot resolver lookup key
    check("inbound_endpoints_channel_check", sql`${t.channel} in ('form','angi','thumbtack')`),
  ],
);

// Idempotency ledger: marketplace webhooks retry. A repeated (org, channel, external_id) is a
// no-op. The form channel has no external_id and relies on phone dedupe instead.
export const inboundLeadReceipts = pgTable(
  "inbound_lead_receipts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    channel: text("channel").notNull(),
    externalId: text("external_id").notNull(),
    leadId: uuid("lead_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("inbound_receipts_dedupe_uq").on(t.orgId, t.channel, t.externalId),
    index("inbound_receipts_org_idx").on(t.orgId),
  ],
);
