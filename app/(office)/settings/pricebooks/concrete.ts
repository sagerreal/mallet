import type { SeedServiceInput } from "@mallet/pricebook";
import type { TradePricebook } from "./types";

/**
 * Starter pricebook for a residential CONCRETE / flatwork shop. Flatwork (driveways, patios,
 * walkways, slabs) is priced by area — `measuredBy: "site_sqft"`. Linear runs (curbs, footings,
 * steps, cracks) are priced by length — `measuredBy: "site_lnft"`. unitPriceCents is the rate
 * PER ONE of that unit in both cases, never a flat job price. The one genuinely per-job line
 * (structural epoxy crack injection — priced per defect/crack, not per area or length) leaves
 * `measuredBy` undefined.
 *
 * All figures are the MIDPOINT of a national 2025/2026 range from the sources below. `costCents`
 * is this shop's own estimated cost (materials + labor burden) on the same per-unit basis —
 * not independently sourced, set at a trade-typical margin (concrete/rebar/forming is
 * material-heavy, so cost runs a higher fraction of price than a labor-only sealing/crack line),
 * matching the plumbing starter pack's pattern.
 *
 * Money: integer cents, same convention as pricebook-seed.ts.
 */

const CONCRETE_CATEGORIES = [
  "Flatwork — Broom Finish",
  "Flatwork — Stamped",
  "Flatwork — Exposed Aggregate",
  "Repair & Leveling",
  "Sealing & Resurfacing",
  "Curbs, Footings & Steps",
] as const;

const CONCRETE_SERVICES: readonly SeedServiceInput[] = [
  // ── Flatwork — Broom Finish ───────────────────────────────────────────────────
  {
    name: "Concrete driveway — broom finish (per sqft)",
    categoryName: "Flatwork — Broom Finish",
    unitPriceCents: 900,
    costCents: 520,
    measuredBy: "site_sqft",
  },
  {
    name: "Concrete patio — broom finish (per sqft)",
    categoryName: "Flatwork — Broom Finish",
    unitPriceCents: 950,
    costCents: 550,
    measuredBy: "site_sqft",
  },
  {
    name: "Concrete sidewalk / walkway — broom finish (per sqft)",
    categoryName: "Flatwork — Broom Finish",
    unitPriceCents: 1000,
    costCents: 580,
    measuredBy: "site_sqft",
  },

  // ── Flatwork — Stamped ────────────────────────────────────────────────────────
  {
    name: "Stamped concrete — driveway/patio (per sqft)",
    categoryName: "Flatwork — Stamped",
    unitPriceCents: 1400,
    costCents: 850,
    measuredBy: "site_sqft",
  },

  // ── Flatwork — Exposed Aggregate ──────────────────────────────────────────────
  {
    name: "Exposed aggregate concrete (per sqft)",
    categoryName: "Flatwork — Exposed Aggregate",
    unitPriceCents: 1100,
    costCents: 650,
    measuredBy: "site_sqft",
  },

  // ── Repair & Leveling ─────────────────────────────────────────────────────────
  {
    name: "Crack repair (per linear ft)",
    categoryName: "Repair & Leveling",
    unitPriceCents: 1650,
    costCents: 700,
    measuredBy: "site_lnft",
  },
  {
    name: "Crack sealing — routing & caulk (per linear ft)",
    categoryName: "Repair & Leveling",
    unitPriceCents: 175,
    costCents: 60,
    measuredBy: "site_lnft",
  },
  {
    name: "Structural crack repair — epoxy injection (per crack)",
    categoryName: "Repair & Leveling",
    unitPriceCents: 37500,
    costCents: 15000,
  },
  {
    name: "Slab leveling / mudjacking (per sqft)",
    categoryName: "Repair & Leveling",
    unitPriceCents: 650,
    costCents: 280,
    measuredBy: "site_sqft",
  },
  {
    name: "Concrete slab replacement (per sqft)",
    categoryName: "Repair & Leveling",
    unitPriceCents: 1050,
    costCents: 620,
    measuredBy: "site_sqft",
  },
  {
    name: "Concrete removal / demolition — unreinforced (per sqft)",
    categoryName: "Repair & Leveling",
    unitPriceCents: 400,
    costCents: 220,
    measuredBy: "site_sqft",
  },
  {
    name: "Concrete removal — reinforced (rebar/mesh, per sqft)",
    categoryName: "Repair & Leveling",
    unitPriceCents: 500,
    costCents: 290,
    measuredBy: "site_sqft",
  },

  // ── Sealing & Resurfacing ─────────────────────────────────────────────────────
  {
    name: "Concrete sealing (per sqft)",
    categoryName: "Sealing & Resurfacing",
    unitPriceCents: 193,
    costCents: 70,
    measuredBy: "site_sqft",
  },
  {
    name: "Concrete resurfacing / overlay (per sqft)",
    categoryName: "Sealing & Resurfacing",
    unitPriceCents: 500,
    costCents: 250,
    measuredBy: "site_sqft",
  },

  // ── Curbs, Footings & Steps ───────────────────────────────────────────────────
  {
    name: "Concrete curbing (per linear ft)",
    categoryName: "Curbs, Footings & Steps",
    unitPriceCents: 1600,
    costCents: 900,
    measuredBy: "site_lnft",
  },
  {
    name: "Concrete footing (per linear ft)",
    categoryName: "Curbs, Footings & Steps",
    unitPriceCents: 500,
    costCents: 270,
    measuredBy: "site_lnft",
  },
  {
    name: "Concrete steps — poured (per linear ft of width)",
    categoryName: "Curbs, Footings & Steps",
    unitPriceCents: 4750,
    costCents: 2600,
    measuredBy: "site_lnft",
  },
];

export const CONCRETE_PRICEBOOK: TradePricebook = {
  key: "concrete",
  categories: CONCRETE_CATEGORIES,
  services: CONCRETE_SERVICES,
  sources: [
    "https://homeguide.com/costs/concrete-driveway-cost",
    "https://yardandgardenguru.com/how-much-concrete-driveway/",
    "https://homeguide.com/costs/concrete-patio-cost",
    "https://concreteblockcalculator.com/knowledge-base/cost-of-concrete-slab/",
    "https://www.concretenetwork.com/stamped-concrete/cost.html",
    "https://www.homewyse.com/maintenance_costs/cost_to_repair_cracked_concrete.html",
    "https://www.angi.com/articles/how-much-does-concrete-sealing-cost.htm",
    "https://homeguide.com/costs/mudjacking-cost",
    "https://www.angi.com/articles/how-much-does-mudjacking-cost.htm",
    "https://www.angi.com/articles/how-much-should-concrete-demo-cost-square-foot.htm",
    "https://homeguide.com/costs/concrete-removal-cost",
    "https://homeguide.com/costs/concrete-resurfacing-cost",
    "https://www.homewyse.com/services/cost_to_install_concrete_curb.html",
    "https://www.angi.com/articles/concrete-footing-cost.htm",
    "https://homeguide.com/costs/concrete-steps-cost",
  ],
};
