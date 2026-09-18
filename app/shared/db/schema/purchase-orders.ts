import { pgTable, uuid, text, integer, numeric, date, timestamp, index, unique, uniqueIndex, foreignKey, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { orgs } from "./orgs";
import { jobs } from "./jobs";

export const purchaseOrders = pgTable(
  "purchase_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    // NULL until the order is placed — a draft has no number to read to a branch.
    num: text("num"),
    vendor: text("vendor").notNull(),
    status: text("status").notNull().default("draft"),
    // NULLABLE ON PURPOSE: a stock/truck-restock order has no job. Forcing one puts a restock on
    // whatever job happened to be open, which corrupts costing worse than having no PO at all.
    jobId: uuid("job_id"),
    orderedAt: date("ordered_at"),
    expectedAt: date("expected_at"),
    // DEPRECATED — kept only because the shared dev/prod DB is additive-only and this column
    // cannot be dropped in the same migration that retires it (see migration 0187). Nothing in
    // the app reads or writes this anymore; its NOT NULL default keeps every insert (which no
    // longer names the column) satisfying the column and its CHECK constraint on its own.
    // shipToAddress (below) is the real field now — Owen wanted an address someone types, not a
    // 3-option picker.
    shipTo: text("ship_to").notNull().default("counter_pickup"),
    // A free-text mailing/service address — replaces shipTo above. Nullable: an order with no
    // address typed yet (or one whose vendor picks it up at the counter) is not an error.
    shipToAddress: text("ship_to_address"),
    orderedByUserId: uuid("ordered_by_user_id"),
    freightCents: integer("freight_cents").notNull().default(0),
    // What the vendor CHARGED, never a rate we compute. org_settings.tax_bps is the SELL-side
    // rate: wrong jurisdiction (the branch's, not the customer's) and wrong direction.
    taxCents: integer("tax_cents").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    unique("purchase_orders_org_id_uq").on(t.orgId, t.id),
    foreignKey({
      name: "purchase_orders_org_job_fk",
      columns: [t.orgId, t.jobId],
      foreignColumns: [jobs.orgId, jobs.id],
    }),
    check("purchase_orders_status_check", sql`${t.status} in ('draft','ordered','cancelled')`),
    check("purchase_orders_ship_to_check", sql`${t.shipTo} in ('counter_pickup','job_site','shop')`),
    // A placed order must carry its number; a draft must not.
    check("purchase_orders_num_check", sql`(${t.status} = 'draft') = (${t.num} is null)`),
    uniqueIndex("purchase_orders_org_num_uidx").on(t.orgId, t.num).where(sql`deleted_at is null and num is not null`),
    index("purchase_orders_org_created_idx").on(t.orgId, t.createdAt.desc(), t.id.desc()),
    index("purchase_orders_org_job_idx").on(t.orgId, t.jobId),
  ],
);

export const purchaseOrderLines = pgTable(
  "purchase_order_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    poId: uuid("po_id").notNull(),
    description: text("description").notNull(),
    // DECIMAL: 100.5 ft of PEX, 3.5 lb of refrigerant. An integer column silently truncates
    // exactly the highest-volume line types.
    qty: numeric("qty", { precision: 12, scale: 3 }).notNull().default("1"),
    uom: text("uom").notNull().default("ea"),
    // THOUSANDTHS OF A CENT — see DECISION 1. $86.40 is 8_640_000.
    unitCostMillicents: integer("unit_cost_millicents").notNull().default(0),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "purchase_order_lines_org_po_fk",
      columns: [t.orgId, t.poId],
      foreignColumns: [purchaseOrders.orgId, purchaseOrders.id],
    }).onDelete("cascade"),
    index("purchase_order_lines_org_po_idx").on(t.orgId, t.poId, t.position),
  ],
);

export const purchaseOrderNotes = pgTable(
  "purchase_order_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    poId: uuid("po_id").notNull(),
    body: text("body").notNull().default(""),
    authorUserId: uuid("author_user_id"),
    // One file may ride a note — a photo of the counter receipt is a whole note on its own.
    attachmentPath: text("attachment_path"),
    attachmentName: text("attachment_name"),
    attachmentType: text("attachment_type"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({
      name: "purchase_order_notes_org_po_fk",
      columns: [t.orgId, t.poId],
      foreignColumns: [purchaseOrders.orgId, purchaseOrders.id],
    }).onDelete("cascade"),
    // A note is text OR a file — same shape rule lead_notes uses.
    check("purchase_order_notes_shape_check", sql`length(trim(${t.body})) > 0 or ${t.attachmentPath} is not null`),
    index("purchase_order_notes_org_po_idx").on(t.orgId, t.poId, t.createdAt.desc()),
  ],
);
