import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  numeric,
  timestamp,
  index,
  uniqueIndex,
  unique,
  check,
  foreignKey,
} from "drizzle-orm/pg-core";
import { orgs } from "./orgs";
import { leads } from "./leads";
import { jobs } from "./jobs";

// A bill for completed work. Total is a snapshot (from the source job); balance due is derived
// from total − deposit − amount_paid, with amount_paid_cents denormalized here and maintained in
// the same tx as each payment. Composite FKs keep every reference intra-org.
export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    num: text("num").notNull(),
    sourceJobId: uuid("source_job_id"),
    /**
     * The job this bill is ABOUT, when it is not the job it was raised FROM.
     *
     * Distinct from `source_job_id`, and deliberately not a substitute for it. `source_job_id`
     * says "this invoice IS the bill for that job" and carries `invoices_org_source_job_uidx` —
     * one active invoice per job. The declined-estimate visit fee must NOT consume that slot: the
     * customer may still accept a quote on the same job later, and its real bill needs the slot.
     * So the fee invoice stays lead-tied (`source_job_id IS NULL`) and records the job it was
     * collected on here instead.
     *
     * Its only job is authorization: it is what lets a technician standing at the door collect a
     * trip fee on the job in front of them (see assertFieldInvoiceScope, which authorizes through
     * `source_job_id` OR this). NOT unique — several scope-linked invoices may point at one job,
     * which is exactly why it cannot be folded into `source_job_id`.
     */
    scopeJobId: uuid("scope_job_id"),
    leadId: uuid("lead_id").notNull(),
    title: text("title"),
    status: text("status").notNull().default("draft"),
    totalCents: integer("total_cents").notNull().default(0),
    // The tax split of `total_cents`, carried from the job that was billed.
    //
    // `total_cents` stays tax-INCLUSIVE. Making it a pre-tax subtotal instead would silently change
    // the balance-due arithmetic (total − deposit − amountPaid) on every invoice that already
    // exists, which is the one thing this must not do. These say how much of the total was tax, so
    // QuickBooks can be told the split and the document can itemise it.
    taxBps: integer("tax_bps").notNull().default(0),
    taxCents: integer("tax_cents").notNull().default(0),
    depositPaidCents: integer("deposit_paid_cents").notNull().default(0),
    amountPaidCents: integer("amount_paid_cents").notNull().default(0),
    termsDays: integer("terms_days").notNull().default(7),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    dueAt: timestamp("due_at", { withTimezone: true }),
    // Customer-supplied purchase order number, free text. Null when the customer didn't issue one.
    poNumber: text("po_number"),
    // Unguessable URL-safe token for the customer-facing public invoice page (no login required).
    // Generated at draft time; null only for invoices created before the migration (backfilled).
    publicToken: text("public_token"),
    // Per-document follow-up: is the shop still chasing this one, and how many nudges in.
    // Was client-local, and the hydrator reset it to off on every refetch — so a toggle the user
    // switched ON read back OFF, disagreeing with whether reminders were actually being sent.
    followUpOn: boolean("follow_up_on").notNull().default(false),
    followUpStage: integer("follow_up_stage").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    unique("invoices_org_id_uq").on(t.orgId, t.id),
    foreignKey({
      name: "invoices_lead_fk",
      columns: [t.orgId, t.leadId],
      foreignColumns: [leads.orgId, leads.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "invoices_source_job_fk",
      columns: [t.orgId, t.sourceJobId],
      foreignColumns: [jobs.orgId, jobs.id],
    }),
    // Composite, like every other child reference here: the scope link can only ever point at a
    // job in the SAME org, enforced by the database rather than by the code that writes it.
    foreignKey({
      name: "invoices_scope_job_fk",
      columns: [t.orgId, t.scopeJobId],
      foreignColumns: [jobs.orgId, jobs.id],
    }),
    index("invoices_org_created_idx").on(t.orgId, t.createdAt.desc(), t.id.desc()),
    // Deliberately a plain index, NOT unique: unlike source_job_id, several invoices may be scoped
    // to one job. The field guard reads by (org, scope_job_id) to find a job's fee invoice.
    index("invoices_org_scope_job_idx").on(t.orgId, t.scopeJobId),
    index("invoices_org_status_due_idx").on(t.orgId, t.status, t.dueAt),
    // Sort indexes for invoice-sorts.ts. due/oldestUnpaid share the due-date index; the existing
    // org_status_due_idx already covers the filtered collection queue.
    index("invoices_org_due_idx").on(t.orgId, t.dueAt, t.id),
    index("invoices_org_total_idx").on(t.orgId, t.totalCents.desc(), t.id.desc()),
    index("invoices_org_lead_idx").on(t.orgId, t.leadId),
    uniqueIndex("invoices_org_num_uidx")
      .on(t.orgId, t.num)
      .where(sql`${t.deletedAt} is null`),
    uniqueIndex("invoices_org_source_job_uidx")
      .on(t.orgId, t.sourceJobId)
      .where(sql`${t.sourceJobId} is not null and ${t.deletedAt} is null`),
    // Partial unique index: public_token must be globally unique when present. NULL rows
    // (pre-migration invoices without a token) are excluded — PostgreSQL nulls are always
    // distinct in unique indexes, but the explicit WHERE makes the intent clear and keeps the
    // index compact.
    uniqueIndex("invoices_public_token_uidx")
      .on(t.publicToken)
      .where(sql`${t.publicToken} is not null`),
    check("invoices_status_check", sql`${t.status} in ('draft', 'sent', 'partial', 'paid', 'void')`),
    check("invoices_total_check", sql`${t.totalCents} >= 0`),
    check("invoices_tax_bps_check", sql`${t.taxBps} >= 0`),
    // Tax is a PART of the total, so it can never exceed it. This is the constraint that catches a
    // caller who mistakes `total_cents` for a pre-tax subtotal.
    check("invoices_tax_cents_check", sql`${t.taxCents} >= 0 and ${t.taxCents} <= ${t.totalCents}`),
    check(
      "invoices_deposit_check",
      sql`${t.depositPaidCents} >= 0 and ${t.depositPaidCents} <= ${t.totalCents}`,
    ),
    check("invoices_amount_paid_check", sql`${t.amountPaidCents} >= 0`),
    check("invoices_terms_check", sql`${t.termsDays} >= 0`),
  ],
);

// Frozen display lines copied from the job/estimate. Composite FK for intra-org containment.
export const invoiceLines = pgTable(
  "invoice_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    invoiceId: uuid("invoice_id").notNull(),
    sourceJobLineId: uuid("source_job_line_id"),
    description: text("description").notNull(),
    quantity: numeric("quantity", { precision: 12, scale: 2, mode: "number" }).notNull(),
    rateCents: integer("rate_cents").notNull().default(0),
    costCents: integer("cost_cents").notNull().default(0),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({
      name: "invoice_lines_invoice_fk",
      columns: [t.orgId, t.invoiceId],
      foreignColumns: [invoices.orgId, invoices.id],
    }).onDelete("cascade"),
    index("invoice_lines_org_inv_idx").on(t.orgId, t.invoiceId),
    check("invoice_lines_qty_check", sql`${t.quantity} >= 0`),
    check("invoice_lines_rate_check", sql`${t.rateCents} >= 0`),
    check("invoice_lines_cost_check", sql`${t.costCents} >= 0`),
  ],
);

// Append-only payment ledger: NO updated_at / deleted_at, never mutated. Deduped on
// (org_id, idempotency_key) so a retried payment never double-applies.
export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    invoiceId: uuid("invoice_id").notNull(),
    amountCents: integer("amount_cents").notNull(),
    method: text("method").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    externalId: text("external_id"),
    // WHO took the money — the authenticated user who recorded this payment. Stamped from the
    // request principal, never from client input. Write-once like every other column here.
    //
    // Nullable and never backfilled, deliberately: rows written before this column existed have no
    // recorded actor, and a card payment settled by the customer online (Stripe webhook) has no
    // in-app actor at all. Null means "nobody in the app took this", not "unknown staffer".
    // No FK to users — same as jobs.assignee_user_id / job_signatures.signed_by_user_id: the ledger
    // must survive a staffer being removed, and it records who acted, not who currently exists.
    recordedByUserId: uuid("recorded_by_user_id"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "payments_invoice_fk",
      columns: [t.orgId, t.invoiceId],
      foreignColumns: [invoices.orgId, invoices.id],
    }).onDelete("cascade"),
    uniqueIndex("payments_org_idem_uidx").on(t.orgId, t.idempotencyKey),
    index("payments_org_invoice_idx").on(t.orgId, t.invoiceId, t.receivedAt.desc()),
    check("payments_amount_check", sql`${t.amountCents} > 0`),
    check("payments_method_check", sql`${t.method} in ('card', 'ach', 'cash', 'check', 'card_terminal')`),
  ],
);
