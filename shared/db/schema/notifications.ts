import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  smallint,
  timestamp,
  index,
  uniqueIndex,
  check,
  foreignKey,
} from "drizzle-orm/pg-core";
import { orgs } from "./orgs";
import { invoices } from "./invoices";
import { estimates } from "./estimates";

// Customer-facing message ledger (SMS/email). Append-only except for the terminal status stamp
// (queued → sent|failed). The related reference uses two TYPED nullable columns — each a composite
// FK — rather than a polymorphic (type,id) pair, so referential integrity + the tenancy invariant
// hold at the DB level (a message can only reference this org's own invoice/estimate). Deduped on
// (org_id, idempotency_key) so a retried send / repeated reminder stage never double-sends.
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    channel: text("channel").notNull(),
    toAddress: text("to_address").notNull(),
    kind: text("kind").notNull(),
    body: text("body").notNull(),
    status: text("status").notNull().default("queued"),
    relatedInvoiceId: uuid("related_invoice_id"),
    relatedEstimateId: uuid("related_estimate_id"),
    reminderStage: smallint("reminder_stage"),
    idempotencyKey: text("idempotency_key").notNull(),
    externalId: text("external_id"),
    error: text("error"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "notifications_invoice_fk",
      columns: [t.orgId, t.relatedInvoiceId],
      foreignColumns: [invoices.orgId, invoices.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "notifications_estimate_fk",
      columns: [t.orgId, t.relatedEstimateId],
      foreignColumns: [estimates.orgId, estimates.id],
    }).onDelete("cascade"),
    uniqueIndex("notifications_org_idem_uidx").on(t.orgId, t.idempotencyKey),
    index("notifications_org_created_idx").on(t.orgId, t.createdAt.desc(), t.id.desc()),
    index("notifications_org_status_idx").on(t.orgId, t.status),
    index("notifications_org_invoice_idx").on(t.orgId, t.relatedInvoiceId),
    check("notifications_channel_check", sql`${t.channel} in ('sms', 'email')`),
    check("notifications_status_check", sql`${t.status} in ('queued', 'sent', 'failed')`),
    check(
      "notifications_stage_check",
      sql`${t.reminderStage} is null or (${t.reminderStage} between 0 and 2)`,
    ),
    // At most one related reference.
    check(
      "notifications_related_one_check",
      sql`not (${t.relatedInvoiceId} is not null and ${t.relatedEstimateId} is not null)`,
    ),
  ],
);
