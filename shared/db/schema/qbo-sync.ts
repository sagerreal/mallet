import { sql } from "drizzle-orm";
import { pgTable, uuid, text, timestamp, uniqueIndex, index, check } from "drizzle-orm/pg-core";
import { orgs } from "./orgs";

// Mallet id → QuickBooks id. Generic from day one (entity_type) so invoices and customers can ride
// the same table later without another migration.
//
// Why explicit mapping instead of matching on name: Jobber's QBO timesheet sync matches employees
// by exact name, and "Mike" vs "Michael" silently breaking payroll is their single biggest support
// burden. A picker costs one screen and removes the whole class of failure.
export const qboEntityLinks = pgTable(
  "qbo_entity_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    entityType: text("entity_type").notNull(),
    // The Mallet-side id (a users.id for 'employee'). Text, not uuid — QBO customers may later map
    // from non-uuid keys.
    malletId: text("mallet_id").notNull(),
    qboId: text("qbo_id").notNull(),
    // QBO requires the current SyncToken on every update. Stored so we don't need a read-before-write.
    qboSyncToken: text("qbo_sync_token"),
    // 'Employee' or 'Vendor' — a 1099 sub is a Vendor in QuickBooks, and TimeActivity needs to know
    // which ref to send. Null for entity types where it doesn't apply.
    qboEntityKind: text("qbo_entity_kind"),
    // Denormalised for display, so the mapping screen doesn't refetch QBO to render a name.
    displayName: text("display_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("qbo_entity_links_org_type_mallet_uidx").on(t.orgId, t.entityType, t.malletId),
    index("qbo_entity_links_org_type_idx").on(t.orgId, t.entityType),
    check(
      "qbo_entity_links_type_check",
      sql`${t.entityType} in ('employee', 'customer', 'service_item')`,
    ),
    check(
      "qbo_entity_links_kind_check",
      sql`${t.qboEntityKind} is null or ${t.qboEntityKind} in ('Employee', 'Vendor')`,
    ),
  ],
);

// One row per attempt to push a Mallet record to QuickBooks.
//
// THIS TABLE IS THE IDEMPOTENCY GUARD, not just an audit trail. The outbox relay is at-least-once
// by design (claim / dispatch / mark are separate transactions), so the same approved week can be
// dispatched twice. Without a unique key on the successful pushes, a retry duplicates hours on a
// real person's paycheck — the worst bug this feature can produce.
export const qboSyncLog = pgTable(
  "qbo_sync_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    entityType: text("entity_type").notNull(),
    malletId: text("mallet_id").notNull(),
    qboId: text("qbo_id"),
    status: text("status").notNull(),
    // A stable discriminator (e.g. "unmapped_employee"), safe to branch on and safe to log.
    errorCode: text("error_code"),
    // Human-facing detail for the sync log UI. Never a token; QBO error text only.
    errorMessage: text("error_message"),
    attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Partial unique: at most ONE succeeded row per Mallet record. A retry of an already-pushed
    // entry hits this and is skipped rather than duplicated. Failures may repeat freely.
    uniqueIndex("qbo_sync_log_succeeded_uidx")
      .on(t.orgId, t.entityType, t.malletId)
      .where(sql`${t.status} = 'succeeded'`),
    index("qbo_sync_log_org_attempted_idx").on(t.orgId, t.attemptedAt),
    check("qbo_sync_log_status_check", sql`${t.status} in ('succeeded', 'failed', 'skipped')`),
  ],
);
