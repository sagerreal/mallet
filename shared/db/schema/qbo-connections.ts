import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  uniqueIndex,
  check,
  foreignKey,
} from "drizzle-orm/pg-core";
import { orgs } from "./orgs";
import { users } from "./users";

// One QuickBooks Online connection per org. RLS is added by a hand-written migration
// (0087_qbo_connections_rls.sql) — drizzle-kit does not emit RLS.
//
// SECURITY: the two token columns hold SEALED values (AES-256-GCM via platform/crypto/secret-box),
// never plaintext. They are the only recoverable secrets in the schema — api_keys stores a one-way
// hash, which doesn't work here because these have to be replayed to Intuit. Nothing in this table
// may be logged.
//
// Both tokens are "" on a disconnected row (see QboConnection.disconnect) rather than nullable:
// the domain treats empty-and-disconnected as legal and empty-and-active as invalid, so a NULL
// would add a third state that means nothing extra.
export const qboConnections = pgTable(
  "qbo_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    // Intuit's company id — every API path is scoped by it. Not unique globally: a QBO company
    // could in principle be connected by two different Mallet orgs.
    realmId: text("realm_id").notNull(),
    accessTokenSealed: text("access_token_sealed").notNull().default(""),
    refreshTokenSealed: text("refresh_token_sealed").notNull().default(""),
    accessExpiresAt: timestamp("access_expires_at", { withTimezone: true }).notNull(),
    // Long-lived, but the VALUE rotates every 24-26h — see modules/qbo/domain/qbo-connection.ts.
    refreshExpiresAt: timestamp("refresh_expires_at", { withTimezone: true }).notNull(),
    status: text("status").notNull().default("active"),
    connectedByUserId: uuid("connected_by_user_id"),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    // QBO REQUIRES a service item (ItemRef) on every TimeActivity. Mallet has no equivalent on a
    // timesheet, so the shop picks one default at connect time. Org-level config, hence here rather
    // than in qbo_entity_links (which maps per-record).
    defaultItemQboId: text("default_item_qbo_id"),
    defaultItemName: text("default_item_name"),
    // The SAME requirement for invoice lines, and deliberately a SEPARATE item from the one above.
    // That one is labour ("Hours"); filing a water heater under it would be wrong. No line in
    // Mallet can name its own item — estimate, job and invoice lines are all free-text description
    // plus money, with no pricebook reference anywhere — so one org-level default is the whole
    // answer available today. Per-item mapping needs a pricebook link that does not exist yet.
    defaultInvoiceItemQboId: text("default_invoice_item_qbo_id"),
    defaultInvoiceItemName: text("default_invoice_item_name"),
    // Opt-in, off by default: connecting must never silently start writing to someone's books.
    sendApprovedHours: boolean("send_approved_hours").notNull().default(false),
    // Its own switch, separate from hours: a shop may want its crew's time in QuickBooks without
    // handing over its invoicing, and turning one on must never turn the other on.
    sendInvoices: boolean("send_invoices").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    disconnectedAt: timestamp("disconnected_at", { withTimezone: true }),
  },
  (t) => [
    // One connection per org — reconnecting updates this row rather than accumulating rows.
    uniqueIndex("qbo_connections_org_uidx").on(t.orgId),
    // Composite FK: whoever connected must live in this connection's org.
    foreignKey({
      name: "qbo_connections_connected_by_fk",
      columns: [t.orgId, t.connectedByUserId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete("set null"),
    check(
      "qbo_connections_status_check",
      sql`${t.status} in ('active', 'needs_reauth', 'disconnected')`,
    ),
  ],
);
