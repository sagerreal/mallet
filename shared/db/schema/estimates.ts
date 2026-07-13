import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  numeric,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
  unique,
  check,
  foreignKey,
} from "drizzle-orm/pg-core";
import { orgs } from "./orgs";
import { leads } from "./leads";

// Customer-facing display names for the three Good/Better/Best tiers (jsonb column shape).
type TierNamesColumn = { good: string; better: string; best: string };

// Snapshot of the AI's original draft lines (jsonb column shape) — written ONCE at draft time
// when the estimate originated from the AI drafter, never updated after. The send path diffs
// this against the lines actually sent to mine edit-delta corrections (quoting_rules proposals).
type AiDraftColumn = {
  lines: {
    description: string;
    quantity: number;
    rateCents: number;
    tier?: "good" | "better" | "best" | null;
  }[];
  at: string; // ISO timestamp of the AI draft
};

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
    // Good/Better/Best: an estimate is tiered iff recommended_tier is non-null. Then every line
    // carries a tier tag (domain-validated); totals derive from the recommended tier pre-accept
    // and the accepted tier post-accept. Single quotes keep all four columns null.
    recommendedTier: text("recommended_tier"),
    // Stamped at accept with the customer's (or office's) tier choice. The accepted estimate's
    // lines are resolved to that tier (tags cleared) — this records which option won.
    acceptedTier: text("accepted_tier"),
    // Customer-facing display names for the three tiers, e.g. {good: "Patch", better: "Repair",
    // best: "Replace"}. Null → default labels.
    tierNames: jsonb("tier_names").$type<TierNamesColumn>(),
    // Snapshot of the selected job terms TEXT at draft time (no live reference — later term
    // edits must not rewrite sent quotes). Rendered on the public quote page and the modal.
    termsSnapshot: text("terms_snapshot"),
    // Unguessable URL-safe token for the customer-facing public quote page (no login required).
    // Generated at draft time; null only for estimates created before the migration (backfilled).
    publicToken: text("public_token"),
    // Stamped the first time a customer opens the public quote link. Idempotent; never updated.
    firstViewedAt: timestamp("first_viewed_at", { withTimezone: true }),
    // The AI drafter's original lines, present only on AI-originated estimates. Write-once
    // snapshot semantics: set at draft via a dedicated repo method; the save() upsert never
    // touches it (deliberately absent from BOTH the insert values and the conflict set), so a
    // later save can never clobber the snapshot the edit-delta miner diffs against.
    aiDraft: jsonb("ai_draft").$type<AiDraftColumn>(),
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
    check(
      "estimates_recommended_tier_check",
      sql`${t.recommendedTier} in ('good', 'better', 'best')`,
    ),
    check("estimates_accepted_tier_check", sql`${t.acceptedTier} in ('good', 'better', 'best')`),
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
    // Good/Better/Best tag. Null on single-format estimates and on resolved (accepted) ones.
    tier: text("tier"),
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
    check("estimate_lines_tier_check", sql`${t.tier} in ('good', 'better', 'best')`),
    check("estimate_lines_rate_check", sql`${t.rateCents} >= 0`),
    check("estimate_lines_cost_check", sql`${t.costCents} >= 0`),
  ],
);
