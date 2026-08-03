import type { SeedServiceInput } from "@mallet/pricebook";
import type { TradePricebook } from "./types";

/**
 * Starter pricebook for a residential FENCING shop. Fence lines are sold and quoted by the
 * LINEAR FOOT of run — `measuredBy: "site_lnft"` and unitPriceCents is the rate PER ONE
 * linear foot, matching how every cost guide below actually prices a fence. Gates and posts
 * are discrete, per-unit items (not a run of any length), so they're seeded as flat per-job
 * prices with `measuredBy` left undefined, per the room/site measurement tool's own kinds.
 *
 * All figures are the MIDPOINT of a national 2025/2026 range from the sources below. `costCents`
 * is this shop's own estimated cost (materials + labor burden) on the same per-unit basis —
 * not independently sourced, set at a trade-typical margin (fencing is material-heavy, so cost
 * runs a higher fraction of price than a labor-only repair line), matching the plumbing starter
 * pack's pattern.
 *
 * Money: integer cents, same convention as pricebook-seed.ts.
 */

const FENCING_CATEGORIES = [
  "Wood Privacy",
  "Chain Link",
  "Vinyl",
  "Aluminum",
  "Gates",
  "Repair & Maintenance",
] as const;

const FENCING_SERVICES: readonly SeedServiceInput[] = [
  // ── Wood Privacy ──────────────────────────────────────────────────────────────
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
  {
    name: "Chain link fence — galvanized, 4-6ft (per linear ft)",
    categoryName: "Chain Link",
    unitPriceCents: 1150,
    costCents: 650,
    measuredBy: "site_lnft",
  },
  {
    name: "Chain link fence — vinyl-coated, 4-6ft (per linear ft)",
    categoryName: "Chain Link",
    unitPriceCents: 1850,
    costCents: 1050,
    measuredBy: "site_lnft",
  },

  // ── Vinyl ─────────────────────────────────────────────────────────────────────
  {
    name: "Vinyl privacy fence (per linear ft)",
    categoryName: "Vinyl",
    unitPriceCents: 6250,
    costCents: 3600,
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
  {
    name: "Aluminum fence (per linear ft)",
    categoryName: "Aluminum",
    unitPriceCents: 4250,
    costCents: 2500,
    measuredBy: "site_lnft",
  },

  // ── Gates (discrete per-unit items — flat) ───────────────────────────────────
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
    name: "Gate repair (hinges, latch, alignment)",
    categoryName: "Gates",
    unitPriceCents: 22500,
    costCents: 8000,
  },

  // ── Repair & Maintenance ──────────────────────────────────────────────────────
  {
    name: "Fence post replacement (single post)",
    categoryName: "Repair & Maintenance",
    unitPriceCents: 26000,
    costCents: 11000,
  },
  {
    name: "Fence panel / section replacement",
    categoryName: "Repair & Maintenance",
    unitPriceCents: 60000,
    costCents: 28000,
  },
  {
    name: "Fence board replacement (single board)",
    categoryName: "Repair & Maintenance",
    unitPriceCents: 20000,
    costCents: 8000,
  },
  {
    name: "Wood fence repair (per linear ft of damaged run)",
    categoryName: "Repair & Maintenance",
    unitPriceCents: 2750,
    costCents: 1400,
    measuredBy: "site_lnft",
  },
  {
    name: "Fence staining & sealing (per linear ft)",
    categoryName: "Repair & Maintenance",
    unitPriceCents: 900,
    costCents: 350,
    measuredBy: "site_lnft",
  },
  {
    name: "Fence pressure washing — pre-stain prep (per linear ft)",
    categoryName: "Repair & Maintenance",
    unitPriceCents: 225,
    costCents: 90,
    measuredBy: "site_lnft",
  },
];

export const FENCING_PRICEBOOK: TradePricebook = {
  key: "fencing",
  categories: FENCING_CATEGORIES,
  services: FENCING_SERVICES,
  sources: [
    "https://www.homeguide.com/costs/wood-fence-cost",
    "https://www.angi.com/articles/how-much-does-it-cost-install-wood-fence.htm",
    "https://www.ergeon.com/blog/post/wood-fence-costs",
    "https://homeguide.com/costs/chain-link-fence-cost",
    "https://www.angi.com/articles/how-much-does-installing-chain-link-fence-cost.htm",
    "https://homeguide.com/costs/vinyl-fence-cost",
    "https://www.ergeon.com/blog/post/vinyl-fence-costs",
    "https://www.angi.com/articles/vinyl-fence-cost.htm",
    "https://bhumicalculator.com/countries/united-states/cost-per-linear-foot-fence",
    "https://homeguide.com/costs/fence-repair-cost",
    "https://www.angi.com/articles/how-much-does-it-cost-repair-fence.htm",
    "https://engineerfix.com/how-much-does-it-cost-to-replace-a-fence-post/",
    "https://homeguide.com/costs/electric-automatic-driveway-gates-cost",
    "https://homeguide.com/costs/cost-to-stain-paint-fence",
    "https://www.angi.com/articles/cost-to-stain-a-fence.htm",
  ],
};
