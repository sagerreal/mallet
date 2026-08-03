import type { SeedServiceInput } from "@mallet/pricebook";
import type { TradePricebook } from "./types";

/**
 * Starter pricebook for a residential FENCING shop. Fence lines are sold and quoted by the
 * LINEAR FOOT of run — `measuredBy: "site_lnft"` and unitPriceCents is the rate PER ONE
 * linear foot, matching how every cost guide below actually prices a fence. Gates, posts,
 * boards and panels are discrete, per-unit items (not a run of any length), so they're seeded
 * as flat per-item prices with `measuredBy` left undefined, per the room/site measurement
 * tool's own kinds.
 *
 * PRICES are the MIDPOINT of a national 2025/2026 range from the sources below, EXCEPT where a
 * line's label blends two heights (the "4-6ft" chain link lines) — those sit slightly below the
 * 6ft midpoint because the source ranges are quoted per height. Any line whose unit or basis is
 * not obvious from its name carries an inline comment; do not re-derive one without reading it.
 *
 * COSTS are this shop's own estimated cost (materials + labor burden) on the same per-unit
 * basis — not independently sourced. Two rules hold across the pack:
 *   1. Material-heavy install lines run a higher cost fraction than labor-only repair lines.
 *   2. NO flat repair/visit line is costed at materials only. This pack has no diagnostic or
 *      trip fee, so "Fence repair — minimum service visit" (cost $90 = one loaded crew hour
 *      including drive time and the truck) is the pack's cost FLOOR: every flat repair line is
 *      costed at that floor plus its own parts and wrench time. Costing a callout at parts only
 *      makes the app's live margin readout report ~75% on the shop's highest-volume ticket, and
 *      the shop then prices the next job down on the strength of a number that was never true.
 *
 * Money: integer cents, same convention as pricebook-seed.ts.
 */

/** One loaded crew hour including drive time — the cost floor for any flat repair line. */
const LOADED_HOUR_COST_CENTS = 9000;

const FENCING_CATEGORIES = [
  "Wood Privacy",
  "Chain Link",
  "Vinyl",
  "Aluminum",
  "Gates",
  "Repair & Maintenance",
  "Site Prep & Removal",
] as const;

const FENCING_SERVICES: readonly SeedServiceInput[] = [
  // ── Wood Privacy ──────────────────────────────────────────────────────────────
  // FIRST site_lnft line in the file, deliberately. The measurement tracer auto-seeds the first
  // line of each measured kind onto a quote (lowest position wins), so this is what a fencing
  // shop gets quoted before it touches anything. Wood 6ft privacy is the volume seller — do not
  // let aluminum, vinyl or a removal line drift above it.
  {
    name: "Wood privacy fence — 6ft (per linear ft)",
    categoryName: "Wood Privacy",
    unitPriceCents: 3750,
    costCents: 2200,
    measuredBy: "site_lnft",
  },
  {
    name: "Wood privacy fence — 8ft (per linear ft)",
    categoryName: "Wood Privacy",
    unitPriceCents: 6250,
    costCents: 3800,
    measuredBy: "site_lnft",
  },

  // ── Chain Link ────────────────────────────────────────────────────────────────
  // Both lines blend two heights. 2026 guides price per height — 4ft galvanized $10-$20/lnft,
  // 6ft galvanized $15-$25/lnft; 6ft black vinyl-coated $20-$35/lnft. The seeded figures sit
  // just under each 6ft midpoint to cover the 4ft end. If the shop sells both heights in volume,
  // split these into separate 4ft and 6ft lines rather than nudging one blended number.
  {
    name: "Chain link fence — galvanized, 4-6ft (per linear ft)",
    categoryName: "Chain Link",
    unitPriceCents: 1800,
    costCents: 1000,
    measuredBy: "site_lnft",
  },
  {
    name: "Chain link fence — vinyl-coated, 4-6ft (per linear ft)",
    categoryName: "Chain Link",
    unitPriceCents: 2500,
    costCents: 1400,
    measuredBy: "site_lnft",
  },

  // ── Vinyl ─────────────────────────────────────────────────────────────────────
  // Height is in the name on purpose. Published vinyl privacy bands blend 6ft and 8ft ($40-$85);
  // 6ft alone is $40-$60, and 8ft is the $85 end. Pricing 6ft off the blended midpoint puts every
  // ordinary vinyl job above the entire 6ft band. Add an 8ft line at ~$85/lnft if the shop sells
  // one — do not average the two heights back into a single number.
  {
    name: "Vinyl privacy fence — 6ft (per linear ft)",
    categoryName: "Vinyl",
    unitPriceCents: 5000,
    costCents: 2900,
    measuredBy: "site_lnft",
  },
  {
    name: "Vinyl picket fence (per linear ft)",
    categoryName: "Vinyl",
    unitPriceCents: 3750,
    costCents: 2100,
    measuredBy: "site_lnft",
  },

  // ── Aluminum ──────────────────────────────────────────────────────────────────
  // Ornamental/picket aluminum: $25-$50/lnft picket, $30-$45/lnft pool-code, $25-$75 overall.
  // Aluminum PRIVACY (louvred) is a different product at $75-$130/lnft — not this line.
  {
    name: "Aluminum fence (per linear ft)",
    categoryName: "Aluminum",
    unitPriceCents: 4250,
    costCents: 2500,
    measuredBy: "site_lnft",
  },

  // ── Gates (discrete per-unit items — flat, one gate) ─────────────────────────
  {
    name: "Gate installation — standard",
    categoryName: "Gates",
    unitPriceCents: 45000,
    costCents: 24000,
  },
  {
    name: "Automatic gate installation (opener + hardware)",
    categoryName: "Gates",
    unitPriceCents: 375000,
    costCents: 220000,
  },
  {
    // Cost = the loaded-hour floor + ~$20 of hinges/latch hardware. Was costed at $80 (parts and
    // a little labor), which reported a 64% margin on a one-hour truck roll.
    name: "Gate repair (hinges, latch, alignment)",
    categoryName: "Gates",
    unitPriceCents: 22500,
    costCents: 11000,
  },

  // ── Repair & Maintenance ──────────────────────────────────────────────────────
  {
    // The pack's trip-fee equivalent, and the cost floor referenced in the header. A truck rolling
    // out for one board or one loose picket costs a loaded crew hour whatever it does when it
    // arrives; published "$100-$300 to replace a single board" figures are THIS number plus the
    // per-item line below, not a per-item rate. Bill this once per visit, then the items on top.
    name: "Fence repair — minimum service visit",
    categoryName: "Repair & Maintenance",
    unitPriceCents: 17500,
    costCents: LOADED_HOUR_COST_CENTS,
  },
  {
    // Per POST. Dig out, re-set in concrete: ~1.5 loaded hours + post and bag mix.
    name: "Fence post replacement (single post)",
    categoryName: "Repair & Maintenance",
    unitPriceCents: 26000,
    costCents: 13500,
  },
  {
    // Per PANEL/SECTION, and WOOD specifically — a vinyl replacement panel is $70-$170 and a chain
    // link section $40-$80, roughly a third of this. Wood panel replacement is $150-$400/panel
    // (midpoint $275); seeded at the midpoint plus a small allowance for the roll.
    name: "Wood fence panel / section replacement",
    categoryName: "Repair & Maintenance",
    unitPriceCents: 30000,
    costCents: 15000,
  },
  {
    // Per BOARD (one picket), NOT per visit. Was seeded at $200, which is a whole-visit total —
    // read as the per-unit rate the name promises, a 12-board storm repair quoted $2,400 against
    // a $400-$600 bid, and disagreed 14x with the per-linear-ft repair line below on the same
    // section of fence. The truck roll now lives in the minimum service visit line above.
    name: "Fence board replacement (single board)",
    categoryName: "Repair & Maintenance",
    unitPriceCents: 3200,
    costCents: 1900,
  },
  {
    name: "Wood fence repair (per linear ft of damaged run)",
    categoryName: "Repair & Maintenance",
    unitPriceCents: 2750,
    costCents: 1400,
    measuredBy: "site_lnft",
  },
  {
    // ONE SIDE of the run. Published per-linear-ft staining rates ($3-$10/lnft for wood privacy,
    // midpoint $6.50) are one face of a 6ft fence; staining both faces roughly doubles it, so
    // quote a both-sides job at twice the measured length rather than editing this rate.
    name: "Fence staining & sealing — one side (per linear ft)",
    categoryName: "Repair & Maintenance",
    unitPriceCents: 650,
    costCents: 350,
    measuredBy: "site_lnft",
  },
  {
    // ONE SIDE, same basis as staining. Washing is quoted per SQ FT ($0.30-$0.40); at a 6ft fence
    // height that is $1.80-$2.40 per linear foot of run for one face.
    name: "Fence pressure washing — pre-stain prep, one side (per linear ft)",
    categoryName: "Repair & Maintenance",
    unitPriceCents: 225,
    costCents: 120,
    measuredBy: "site_lnft",
  },

  // ── Site Prep & Removal ───────────────────────────────────────────────────────
  {
    // Tear-out is on nearly every replacement job, and replacement is most of a fencing shop's
    // revenue — without this line every replacement quote is short by $600-$2,000 on a 200ft run.
    // $3-$10/lnft including haul-away and dump fees; seeded at the midpoint. Keep this line BELOW
    // the wood 6ft line in file order: the tracer auto-seeds the first site_lnft line, and a
    // traced yard must not come back quoted as a demolition.
    name: "Old fence removal & haul-away (per linear ft)",
    categoryName: "Site Prep & Removal",
    unitPriceCents: 650,
    costCents: 350,
    measuredBy: "site_lnft",
  },
];

export const FENCING_PRICEBOOK: TradePricebook = {
  key: "fencing",
  categories: FENCING_CATEGORIES,
  services: FENCING_SERVICES,
  sources: [
    // Wood
    "https://www.homeguide.com/costs/wood-fence-cost",
    "https://www.angi.com/articles/how-much-does-it-cost-install-wood-fence.htm",
    "https://www.ergeon.com/blog/post/wood-fence-costs",
    // Chain link
    "https://homeguide.com/costs/chain-link-fence-cost",
    "https://www.angi.com/articles/how-much-does-installing-chain-link-fence-cost.htm",
    "https://www.ergeon.com/blog/post/chain-link-fence-costs",
    // Vinyl
    "https://homeguide.com/costs/vinyl-fence-cost",
    "https://www.ergeon.com/blog/post/vinyl-fence-costs",
    "https://www.angi.com/articles/vinyl-fence-cost.htm",
    // Aluminum — replaces bhumicalculator.com, an auto-generated multi-country SEO calculator
    // with no methodology and no citations, which was the only page covering the aluminum line.
    "https://homeguide.com/costs/aluminum-fence-cost",
    "https://www.angi.com/articles/how-much-does-aluminum-or-steel-fence-cost.htm",
    // Repair
    "https://homeguide.com/costs/fence-repair-cost",
    "https://www.angi.com/articles/how-much-does-it-cost-repair-fence.htm",
    "https://engineerfix.com/how-much-does-it-cost-to-replace-a-fence-post/",
    "https://www.homewyse.com/maintenance_costs/cost_to_repair_fence_board.html",
    // Gates
    "https://homeguide.com/costs/electric-automatic-driveway-gates-cost",
    // Staining & washing
    "https://homeguide.com/costs/cost-to-stain-paint-fence",
    "https://www.angi.com/articles/cost-to-stain-a-fence.htm",
    "https://www.fixr.com/costs/pressure-wash-fence",
    "https://www.angi.com/articles/how-much-cost-pressure-wash-fence.htm",
  ],
};
