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

// Frozen presentation attached to a quote (jsonb column shape): the designed pages the customer
// sees around the estimate, copied from a presentation_template at draft time. Same snapshot
// semantics as terms_snapshot — later template edits never rewrite a sent quote. Carries no
// money and no internal fields; safe on every public surface by construction.
type PresentationSnapshotColumn = {
  templateName: string;
  pages: {
    key: "cover" | "letter" | "about" | "photos" | "process" | "reviews" | "warranty" | "thanks";
    title: string;
    body: string;
    /** Object keys in the private bucket, never URLs — see PresentationPhoto. */
    photos?: { id: string; key: string; beforeKey?: string | null; caption?: string | null }[];
  }[];
  /** Absent reads as 'simple' — every snapshot written before the document had a mode. */
  mode?: "simple" | "full";
  design?: {
    /** A lib/doc-fonts key. String at rest — the domain validates membership on read/write. */
    font?: string;
    size?: number;
    accent?: string;
    bold?: boolean;
    italic?: boolean;
  };
  meta?: {
    estimator?: string;
    estimatorRole?: string;
    contact?: string;
    estNumber?: string;
    validity?: string;
    date?: string;
  };
};

// Internal estimating math behind one line (jsonb column shape): the substrate rows that roll up
// into the line's rate. Money is integer cents. NEVER serialized to any customer-facing surface —
// redacted exactly like cost_cents.
type SubItemsColumn = {
  description: string;
  quantity: number;
  unit: string | null;
  amountCents: number;
}[];

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
    // Provenance: where this quote was born. 'office' = the ordinary draft→send→accept path;
    // 'field' = priced and signed ON SITE via v1.field.signQuote — born accepted, evidenced by
    // the same signature columns below. Write-once (never flips after creation).
    origin: text("origin").notNull().default("office"),
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
    // Which numbers the customer sees on the public quote: 'lines' = per-line extended amounts
    // (the default, today's behavior), 'total' = scope prose + one price at the bottom (the
    // PaintScout-style proposal). Display-only — rates stay in the data either way, and optional
    // add-on prices always show (adding one changes the total, so its price must be visible).
    priceDisplay: text("price_display").notNull().default("lines"),
    // The designed proposal pages frozen at draft time — null on a plain quote (the default).
    presentationSnapshot: jsonb("presentation_snapshot").$type<PresentationSnapshotColumn>(),

    // ---- Signature evidence -------------------------------------------------------------------
    //
    // acceptedAt alone proves only that SOMEBODY HOLDING THE LINK clicked at a moment in time. It
    // names nobody. A customer who later says "I never agreed to that" is arguing against a
    // timestamp, and a shop chasing $19,500 has nothing to put in front of them.
    //
    // All nullable: the office can still mark an estimate accepted itself (a phone approval), and
    // that path legitimately has no signature. Null here means "accepted without a signature",
    // which is a real and different thing from "signed" — the UI must not conflate them.

    /** Typed name, as the signer entered it. The attribution — without it a drawn squiggle names nobody. */
    signerName: text("signer_name"),
    /** The drawn mark, an SVG path. Evidence of a deliberate act, not of identity. */
    signatureSvg: text("signature_svg"),
    /** Captured server-side from the request, never from the client — a client-supplied IP is worthless. */
    signerIp: text("signer_ip"),
    signerUserAgent: text("signer_user_agent"),
    signedAt: timestamp("signed_at", { withTimezone: true }),
    /**
     * Frozen copy of EXACTLY what the signer saw: every line, the totals, the chosen tier, the
     * terms text.
     *
     * Without this the signature refers to a live row that can be edited afterwards, so it proves
     * nothing about the amount — which is the whole dispute. termsSnapshot already froze the terms
     * for the same reason; this extends that to the money.
     */
    signedSnapshot: jsonb("signed_snapshot"),
    /**
     * The job this quote adds work to — a CHANGE ORDER.
     *
     * Null on an ordinary quote, which sells work before a job exists. Set when the quote was
     * raised from inside a job that is already running: more was found on site, it was priced, and
     * the customer has to agree to it. Housecall Pro models a change order the same way — an
     * estimate created on the job, whose approved lines are copied into it.
     *
     * The link is what lets the invoice sum EVERY signature that governs a job rather than only
     * the one on the original quote.
     */
    changeOrderForJobId: uuid("change_order_for_job_id"),
    // The job this estimate produced (or is attached to) once accepted — the read-side link back
    // from a quote to the job it became. Null until a job exists for it.
    jobId: uuid("job_id"),
    // Unguessable URL-safe token for the customer-facing public quote page (no login required).
    // Generated at draft time; null only for estimates created before the migration (backfilled).
    publicToken: text("public_token"),
    // Stamped the first time a customer opens the public quote link. Idempotent; never updated.
    firstViewedAt: timestamp("first_viewed_at", { withTimezone: true }),
    // Per-document follow-up: is the shop still chasing this one, and how many nudges in.
    // Was client-local, and the hydrator reset it to off on every refetch — so a toggle the user
    // switched ON read back OFF, disagreeing with whether reminders were actually being sent.
    followUpOn: boolean("follow_up_on").notNull().default(false),
    followUpStage: integer("follow_up_stage").notNull().default(0),
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
    // estimates_job_fk (composite FK to jobs(org_id, id)) is hand-written into the generated
    // migration SQL rather than declared here: jobs.ts already imports estimates.ts, and adding
    // `import { jobs } from "./jobs"` here creates a circular import that breaks `tsc --noEmit`
    // (TS7022/TS7024 implicit-any on both estimates and jobs). The constraint still exists in the
    // live DB — see the migration file — this comment is the only place it's declared in code.
    index("estimates_org_created_idx").on(t.orgId, t.createdAt.desc(), t.id.desc()),
    // Backs the `sent` sort. Without it, ordering by sent_at is a sequential scan over the whole
    // tenant — fine at a few hundred quotes, a timeout at forty thousand.
    index("estimates_org_sent_idx").on(t.orgId, t.sentAt.desc(), t.id.desc()),
    index("estimates_org_lead_idx").on(t.orgId, t.leadId),
    // Backs quoting.list({status}) — filtering the board's worklist by status without a
    // sequential scan over the whole tenant.
    index("estimates_org_status_idx").on(t.orgId, t.status),
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
    check("estimates_origin_check", sql`${t.origin} in ('office', 'field')`),
    check(
      "estimates_recommended_tier_check",
      sql`${t.recommendedTier} in ('good', 'better', 'best')`,
    ),
    check("estimates_accepted_tier_check", sql`${t.acceptedTier} in ('good', 'better', 'best')`),
    check("estimates_disc_bps_check", sql`${t.discBps} between 0 and 10000`),
    check("estimates_tax_bps_check", sql`${t.taxBps} >= 0`),
    check("estimates_dep_bps_check", sql`${t.depBps} between 0 and 10000`),
    check("estimates_price_display_check", sql`${t.priceDisplay} in ('lines', 'total')`),
  ],
);

// A priced line on an estimate. Composite FK (org_id, estimate_id) enforces intra-org containment.
/**
 * A named group of lines on one estimate — "Demolition & site prep", "New fence" — with its own
 * subtotal on the customer's copy. A real table rather than a string on the line so a section can
 * be renamed, reordered and emptied without touching its members, and so an empty section can
 * exist while the estimator builds it out.
 *
 * Lines reference it nullably: an ungrouped line keeps its place in the document, it just has no
 * heading above it.
 */
/**
 * A cost on the job this quote prices that is NOT one of the quote's lines — a permit, a
 * dumpster, a sub's day, or a purchase order already placed against the job.
 *
 * These never touch the customer's price. They exist so the margin the estimator reads is the
 * real one: a $4,495 repaint with a $400 dumpster behind it is not a $4,495 repaint.
 *
 * `purchase_order_id` is PROVENANCE and a snapshot, not a live link. It records that this row
 * came from PO-1042 so the same order cannot be pulled onto the quote twice; the amount is
 * frozen at the moment it was pulled, like every other snapshot in this codebase. No FK, same
 * rule as estimate_lines.material_id: a deleted order must not cascade into a sent quote.
 *
 * RLS keyed on org_id (hand-written migration — drizzle-kit does not emit it).
 */
export const estimateJobCosts = pgTable(
  "estimate_job_costs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    estimateId: uuid("estimate_id").notNull(),
    description: text("description").notNull(),
    amountCents: integer("amount_cents").notNull().default(0),
    purchaseOrderId: uuid("purchase_order_id"),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    unique("estimate_job_costs_org_id_key").on(t.orgId, t.id),
    foreignKey({
      name: "estimate_job_costs_estimate_fk",
      columns: [t.orgId, t.estimateId],
      foreignColumns: [estimates.orgId, estimates.id],
    }).onDelete("cascade"),
    index("estimate_job_costs_org_est_idx").on(t.orgId, t.estimateId),
    check("estimate_job_costs_amount_check", sql`${t.amountCents} >= 0`),
  ],
);

export const estimateSections = pgTable(
  "estimate_sections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    estimateId: uuid("estimate_id").notNull(),
    name: text("name").notNull(),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({
      name: "estimate_sections_estimate_fk",
      columns: [t.orgId, t.estimateId],
      foreignColumns: [estimates.orgId, estimates.id],
    }).onDelete("cascade"),
    // The composite target estimate_lines.section_id points at.
    unique("estimate_sections_org_id_key").on(t.orgId, t.id),
    index("estimate_sections_org_est_idx").on(t.orgId, t.estimateId),
  ],
);

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
    /**
     * Does this line take sales tax. Inherited from the pricebook item/material it came from and
     * overridable per line — the model Housecall Pro and Jobber both use.
     *
     * DEFAULT TRUE, and that default is load-bearing. Every estimate line written before this
     * column existed was summed into a tax base with no exclusions, so `true` is what those rows
     * already meant; `false` would have silently rebased 594 live quotes. The rate still lives on
     * the estimate header (one rate per document, same as both incumbents) — this only decides
     * which lines it is charged on.
     */
    taxable: boolean("taxable").notNull().default(true),
    position: integer("position").notNull().default(0),
    // Good/Better/Best tag. Null on single-format estimates and on resolved (accepted) ones.
    tier: text("tier"),
    // Provenance pointer when this line came from a pricebook MATERIAL (the sellable-parts
    // model). Values are snapshotted above (rate/cost never move with the catalog); the id
    // survives for costing and future reprice-from-book actions. No FK — a deleted material
    // must not constrain its historical lines.
    materialId: uuid("material_id"),
    /**
     * The pricebook SERVICE this line came from. Provenance, like materialId — and for an
     * assembly it is also the link that makes "Update in pricebook" possible: without it the
     * only way to tell which saved entry a line came from is to match on description, which is
     * wrong the moment someone renames the line.
     *
     * A snapshot pointer, never live repricing: editing the pricebook entry does not change a
     * quote already built from it. Deliberately NO foreign key, same as materialId above — a
     * deleted pricebook entry must not cascade into the history of quotes already sent.
     */
    pricebookItemId: uuid("pricebook_item_id"),
    // Customer-facing scope prose under this line: Includes / Excludes / Prep / Products, plain
    // text rendered pre-wrap. This is the "pages of words" a $2-15M shop's proposal carries.
    scope: text("scope"),
    // The estimating math behind the line's price (see SubItemsColumn). Jsonb, not a child table:
    // sub-items are never queried independently and live and die with their line. The line's
    // rate_cents stays the single pricing source of truth — the composer derives it from these,
    // the server never enforces the sum.
    subItems: jsonb("sub_items").$type<SubItemsColumn>(),
    // The unit the quantity is counted in — "LF", "hr", "bags". Display only: it never enters
    // the money math (amount is still quantity × rate), it tells the customer what they are
    // buying 100 of. Null on a line that is simply a thing rather than a measured amount.
    unit: text("unit"),
    /**
     * The TYPED MATH behind `quantity`, when the estimator authored one ("qty/8+1" posts off a
     * fence run). `quantity` above stays the resolved number every total, DTO, public page and
     * invoice reads; this is the authoring layer, re-evaluated server-side on every write by
     * modules/quoting/domain/quantity-expression.ts so the two can never disagree.
     */
    qtyExpr: text("qty_expr"),
    /** Round the resolved quantity up to a whole unit — you cannot buy half a post. */
    roundUp: boolean("round_up").notNull().default(false),
    /**
     * The parent this line is a component of, for an assembly: the parent carries the customer
     * price and the children carry the estimating math. Composite FK to (org_id, id) on this
     * same table. Null on an ordinary line.
     */
    parentLineId: uuid("parent_line_id"),
    /** The named group this line sits under, if any. */
    sectionId: uuid("section_id"),
    /**
     * Does the customer see this line at all. DEFAULT TRUE, load-bearing for the same reason
     * `taxable` is: every line written before this column existed was shown, so `true` is what
     * those rows already meant. Distinct from `is_optional` (visible, and choosable) and from
     * the header's `price_display` (which hides amounts, not lines).
     */
    customerVisible: boolean("customer_visible").notNull().default(true),
    /**
     * Markup over cost, in basis points, when this line is priced from its cost rather than
     * hand-priced. Null = hand-priced; `rate_cents` is the truth either way.
     */
    markupBps: integer("markup_bps"),
    /**
     * What KIND of cost this line is — material / labor / equipment / subcontract / other.
     * Office-side categorisation (costing reads it later); the customer never sees it.
     * Text, not an enum type: the vocabulary is validated at the boundary and a new kind
     * must not need a migration.
     */
    lineType: text("line_type"),
    /**
     * Photos attached to the line — office-side reference material ("this is the panel"),
     * never rendered on the customer copy. Jsonb like sub_items: attachments live and die
     * with their line and are never queried independently. Each entry is a key into the
     * org's proposal-photo storage plus the name it was attached under.
     */
    attachments: jsonb("attachments").$type<{ key: string; name: string }[]>(),
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
    // A component dies with its parent. Tenant-safe: a line can only parent a line in its own org.
    foreignKey({
      name: "estimate_lines_parent_fk",
      columns: [t.orgId, t.parentLineId],
      foreignColumns: [t.orgId, t.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "estimate_lines_section_fk",
      columns: [t.orgId, t.sectionId],
      foreignColumns: [estimateSections.orgId, estimateSections.id],
    }).onDelete("set null"),
    // The target of the parent self-FK above — a composite FK needs a unique to point at.
    unique("estimate_lines_org_id_uq").on(t.orgId, t.id),
    index("estimate_lines_org_est_idx").on(t.orgId, t.estimateId),
    index("estimate_lines_org_parent_idx").on(t.orgId, t.parentLineId),
    check("estimate_lines_qty_check", sql`${t.quantity} >= 0`),
    check("estimate_lines_markup_check", sql`${t.markupBps} is null or ${t.markupBps} >= 0`),
    check("estimate_lines_tier_check", sql`${t.tier} in ('good', 'better', 'best')`),
    check("estimate_lines_rate_check", sql`${t.rateCents} >= 0`),
    check("estimate_lines_cost_check", sql`${t.costCents} >= 0`),
  ],
);
