import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  foreignKey,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { orgs } from "./orgs";
import { leads } from "./leads";

/**
 * The customer's card on file — the REUSABLE payment method Stripe saved when they paid, so the
 * shop can charge the balance at the door without another tap ("paid before they left").
 *
 * WHAT IS STORED, AND WHAT NEVER IS. Two Stripe POINTERS (`cus_…`, `pm_…`) and two PRESENTATIONAL
 * facts (brand, last4) so a surface can say "Charge Visa ···· 4242" without dialing Stripe. No
 * PAN, no expiry, no fingerprint — the card itself lives at Stripe, and the pointers are useless
 * outside this platform's secret key. Brand and last4 are what Stripe itself prints on receipts.
 *
 * WHERE THE POINTERS LIVE AT STRIPE. On the PLATFORM account, because that is where Checkout
 * saved them: the pay-link/QR session is platform-held (a destination charge —
 * stripe-client.ts createCheckoutSession), so `setup_future_usage` attaches the card to a
 * platform Customer. Charging it later is another destination charge with the same
 * on_behalf_of/transfer_data posture. Storing them "on the connected account" would describe
 * pointers that do not exist there.
 *
 * ONE ROW PER CUSTOMER (org_id, lead_id UNIQUE), replaced on each save: the product promise is
 * "the card on file", not a wallet. The newest successful payment wins — that is the card the
 * customer most recently proved they control. Replacement is an UPDATE in place (upsert), so
 * there is no deleted_at: superseding a pointer row is not deleting tenant history (the payments
 * ledger holds the history; this row is a live pointer, like qbo_connections' tokens).
 *
 * `via` says WHICH payment saved it — 'payment' (an invoice) or 'deposit' (a quote deposit) — so
 * the charge button can answer the customer's inevitable "you have my card?" with a specific,
 * checkable fact ("saved when you paid the deposit").
 */
export const paymentProfiles = pgTable(
  "payment_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    // FK enforced compositely on (org_id, lead_id) below — never a bare lead_id — so a profile
    // row cannot even reference a customer belonging to another org.
    leadId: uuid("lead_id").notNull(),
    /** The Stripe Customer (cus_…) on the PLATFORM account that owns the saved method. */
    stripeCustomerId: text("stripe_customer_id").notNull(),
    /** The reusable payment method (pm_…) attached to that customer. */
    stripePaymentMethodId: text("stripe_payment_method_id").notNull(),
    /** Presentational: the network Stripe reported ("visa", "mastercard", …). */
    brand: text("brand").notNull(),
    /** Presentational: the last four digits Stripe reported. Never more of the number. */
    last4: text("last4").notNull(),
    /** Which payment saved this card: 'payment' (invoice) or 'deposit' (quote deposit). */
    via: text("via").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "payment_profiles_lead_fk",
      columns: [t.orgId, t.leadId],
      foreignColumns: [leads.orgId, leads.id],
    }).onDelete("cascade"),
    // One card on file per customer; the upsert's conflict target.
    uniqueIndex("payment_profiles_org_lead_uidx").on(t.orgId, t.leadId),
    check("payment_profiles_last4_check", sql`${t.last4} ~ '^[0-9]{4}$'`),
    check("payment_profiles_via_check", sql`${t.via} in ('payment', 'deposit')`),
  ],
);
