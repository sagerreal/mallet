import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  index,
  uniqueIndex,
  check,
  foreignKey,
} from "drizzle-orm/pg-core";
import { orgs } from "./orgs";
import { estimates } from "./estimates";

/**
 * Deposits actually COLLECTED against a quote — an append-only ledger, deliberately shaped like
 * `payments` (the invoice ledger) rather than a column.
 *
 * `estimates.dep_paid_cents` used to be the whole story: a bare mutable integer with no record of
 * WHICH money produced it. That cannot express the two cases the deposit paths must tell apart,
 * because by amount alone they are identical:
 *
 *   - the SAME payment delivered twice (Stripe webhook + /pay/success reconcile, either first) —
 *     must be recorded once;
 *   - TWO DIFFERENT payments on one quote — must both be kept.
 *
 * `SET` is wrong for the second (it erases one), `+=` is wrong for the first (it double-counts).
 * Neither works without identity, and the second case is reachable today: `Estimate.resignOnSite`
 * (behind v1.field.signQuote) replaces the line set on an already-accepted quote, so depositDue()
 * moves and a second checkout session can exist alongside the first.
 *
 * `payment_ref` is that identity: the settling Stripe payment_intent id — the SAME value the
 * invoice path dedupes its ledger on. UNIQUE (org_id, payment_ref) is the idempotency key, so a
 * duplicate delivery is an ON CONFLICT DO NOTHING no-op and two distinct payments are two rows.
 * `dep_paid_cents` is then DERIVED as SUM(amount_cents) and never blind-written.
 *
 * Append-only, exactly like `payments`: no updated_at, no deleted_at. A deposit that has to be
 * given back is a refund — a new fact, not an edit to this one.
 */
export const estimateDeposits = pgTable(
  "estimate_deposits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    // FK enforced compositely on (org_id, estimate_id) below — never a bare estimate_id — so a
    // deposit row cannot even reference an estimate belonging to another org.
    estimateId: uuid("estimate_id").notNull(),
    /** The settling Stripe payment_intent id (pi_…). The idempotency key, with org_id. */
    paymentRef: text("payment_ref").notNull(),
    amountCents: integer("amount_cents").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "estimate_deposits_estimate_fk",
      columns: [t.orgId, t.estimateId],
      foreignColumns: [estimates.orgId, estimates.id],
    }).onDelete("cascade"),
    uniqueIndex("estimate_deposits_org_ref_uidx").on(t.orgId, t.paymentRef),
    index("estimate_deposits_org_estimate_idx").on(t.orgId, t.estimateId, t.receivedAt.desc()),
    check("estimate_deposits_amount_check", sql`${t.amountCents} > 0`),
  ],
);
