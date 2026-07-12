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

// A customer quote. Header + lines (see estimate_lines). Money is integer cents; percentages are
// integer basis points. RLS isolates by org_id.
export const estimates = pgTable(
  "estimates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    num: text("num").notNull(),
    // FK enforced compositely on (org_id, lead_id) below — never a bare lead_id — so an estimate
    // can only reference a lead in its OWN org.
    leadId: uuid("lead_id").notNull(),
    title: text("title"),
    status: text("status").notNull().default("draft"),
    discBps: integer("disc_bps").notNull().default(0),
    taxBps: integer("tax_bps").notNull().default(0),
    depBps: integer("dep_bps").notNull().default(0),
    depPaidCents: integer("dep_paid_cents").notNull().default(0),
    validDays: integer("valid_days"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    declinedAt: timestamp("declined_at", { withTimezone: true }),
    declineReason: text("decline_reason"),
    changeRequestedAt: timestamp("change_requested_at", { withTimezone: true }),
    changeRequest: text("change_request"),
    // Unguessable URL-safe token for the customer-facing public quote page (no login required).
    // Generated at draft time; null only for estimates created before the migration (backfilled).
    publicToken: text("public_token"),
    // Stamped the first time a customer opens the public quote link. Idempotent; never updated.
    firstViewedAt: timestamp("first_viewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    // Target of the estimate_lines composite FK — a line can only reference (org_id, id) pairs
    // that exist, so it can never point at another tenant's estimate.
    unique("estimates_org_id_uq").on(t.orgId, t.id),
    // Composite FK to leads(org_id, id): the referenced lead must share this estimate's org, so a
    // tenant cannot attach an estimate to another org's lead (RI checks run owner-side, bypassing
    // RLS — the composite key is what actually closes the hole).
    foreignKey({
      name: "estimates_lead_fk",
      columns: [t.orgId, t.leadId],
      foreignColumns: [leads.orgId, leads.id],
    }).onDelete("cascade"),
    index("estimates_org_created_idx").on(t.orgId, t.createdAt.desc(), t.id.desc()),
    index("estimates_org_lead_idx").on(t.orgId, t.leadId),
    uniqueIndex("estimates_org_num_uidx")
      .on(t.orgId, t.num)
      .where(sql`${t.deletedAt} is null`),
    // Partial unique index: public_token must be globally unique when present. NULL rows (pre-migration
    // estimates without a token) are excluded — PostgreSQL nulls are always distinct in unique indexes,
    // but the explicit WHERE makes the intent clear and keeps the index compact.
    uniqueIndex("estimates_public_token_uidx")
      .on(t.publicToken)
      .where(sql`${t.publicToken} is not null`),
    check("estimates_status_check", sql`${t.status} in ('draft', 'sent', 'accepted', 'declined')`),
    check("estimates_disc_bps_check", sql`${t.discBps} between 0 and 10000`),
    check("estimates_tax_bps_check", sql`${t.taxBps} >= 0`),
    check("estimates_dep_bps_check", sql`${t.depBps} between 0 and 10000`),
  ],
);

// A priced line on an estimate. Composite FK (org_id, estimate_id) enforces intra-org containment.
export const estimateLines = pgTable(
  "estimate_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    estimateId: uuid("estimate_id").notNull(),
    description: text("description").notNull(),
    quantity: numeric("quantity", { precision: 12, scale: 2, mode: "number" }).notNull(),
    rateCents: integer("rate_cents").notNull().default(0),
    costCents: integer("cost_cents").notNull().default(0),
    isOptional: boolean("is_optional").notNull().default(false),
    needsPhoto: boolean("needs_photo").notNull().default(false),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({
      name: "estimate_lines_estimate_fk",
      columns: [t.orgId, t.estimateId],
      foreignColumns: [estimates.orgId, estimates.id],
    }).onDelete("cascade"),
    index("estimate_lines_org_est_idx").on(t.orgId, t.estimateId),
    check("estimate_lines_qty_check", sql`${t.quantity} >= 0`),
    check("estimate_lines_rate_check", sql`${t.rateCents} >= 0`),
    check("estimate_lines_cost_check", sql`${t.costCents} >= 0`),
  ],
);
