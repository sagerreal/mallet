import type { SeedServiceInput } from "@mallet/pricebook";
import type { TradePricebook } from "./types";

/**
 * Starter pricebook for a residential PAINTING shop — the trade the interior room-measurement
 * feature (walls_sqft / ceiling_sqft / baseboard_lnft / crown_lnft / doors_count / windows_count)
 * was actually built for. Most lines here carry a `measuredBy` and unitPriceCents is the rate
 * PER ONE of that unit (per sqft, per linear ft, per door/window) — never a flat job price,
 * because a flat "Interior painting — $X" is wrong for every room that isn't exactly average.
 *
 * Cabinet refinishing has no measured-quantity kind (the room-measurement tool doesn't take
 * cabinet linear footage), so those lines are seeded as flat tiers (small/medium/large kitchen)
 * off a per-linear-ft market rate applied to typical kitchen footages — flagged in `sources`.
 *
 * All figures are the MIDPOINT of a national 2025/2026 range from the sources below. `costCents`
 * is this shop's own estimated cost (materials + labor burden) on the same per-unit basis —
 * not independently sourced, set at a trade-typical margin (higher for material-heavy install
 * lines, lower for labor-only repair/prep lines), matching the plumbing starter pack's pattern.
 *
 * Money: integer cents, same convention as pricebook-seed.ts.
 */

const PAINTING_CATEGORIES = [
  "Interior Walls & Ceilings",
  "Trim, Doors & Windows",
  "Exterior",
  "Cabinets",
  "Prep & Repair",
] as const;

const PAINTING_SERVICES: readonly SeedServiceInput[] = [
  // ── Interior Walls & Ceilings ────────────────────────────────────────────────
  {
    name: "Interior wall painting (2 coats)",
    categoryName: "Interior Walls & Ceilings",
    unitPriceCents: 400,
    costCents: 190,
    measuredBy: "walls_sqft",
  },
  {
    name: "Ceiling painting",
    categoryName: "Interior Walls & Ceilings",
    unitPriceCents: 200,
    costCents: 95,
    measuredBy: "ceiling_sqft",
  },
  {
    name: "Wallpaper removal",
    categoryName: "Interior Walls & Ceilings",
    unitPriceCents: 190,
    costCents: 85,
    measuredBy: "walls_sqft",
  },
  {
    name: "Popcorn ceiling removal",
    categoryName: "Interior Walls & Ceilings",
    unitPriceCents: 177,
    costCents: 80,
    measuredBy: "ceiling_sqft",
  },

  // ── Trim, Doors & Windows ─────────────────────────────────────────────────────
  {
    name: "Baseboard / trim painting",
    categoryName: "Trim, Doors & Windows",
    unitPriceCents: 250,
    costCents: 110,
    measuredBy: "baseboard_lnft",
  },
  {
    name: "Crown molding painting",
    categoryName: "Trim, Doors & Windows",
    unitPriceCents: 700,
    costCents: 320,
    measuredBy: "crown_lnft",
  },
  {
    name: "Interior door & frame painting",
    categoryName: "Trim, Doors & Windows",
    unitPriceCents: 12300,
    costCents: 5500,
    measuredBy: "doors_count",
  },
  {
    name: "Interior window trim & frame painting",
    categoryName: "Trim, Doors & Windows",
    unitPriceCents: 8750,
    costCents: 3800,
    measuredBy: "windows_count",
  },

  // ── Exterior ──────────────────────────────────────────────────────────────────
  {
    name: "Exterior house painting",
    categoryName: "Exterior",
    unitPriceCents: 300,
    costCents: 150,
    measuredBy: "site_sqft",
  },
  {
    name: "Exterior power washing (pre-paint prep)",
    categoryName: "Exterior",
    unitPriceCents: 16,
    costCents: 6,
    measuredBy: "site_sqft",
  },

  // ── Cabinets (no measured-quantity kind exists for cabinet linear footage —
  //     seeded as flat tiers off a per-linear-ft market rate; see sources) ──────
  {
    name: "Cabinet refinishing — small kitchen (~10 linear ft)",
    categoryName: "Cabinets",
    unitPriceCents: 50000,
    costCents: 24000,
  },
  {
    name: "Cabinet refinishing — medium kitchen (~20 linear ft)",
    categoryName: "Cabinets",
    unitPriceCents: 100000,
    costCents: 48000,
  },
  {
    name: "Cabinet refinishing — large kitchen (~30 linear ft)",
    categoryName: "Cabinets",
    unitPriceCents: 150000,
    costCents: 72000,
  },

  // ── Prep & Repair ─────────────────────────────────────────────────────────────
  {
    name: "Drywall patch — small hole (up to 4in)",
    categoryName: "Prep & Repair",
    unitPriceCents: 11250,
    costCents: 3500,
  },
  {
    name: "Drywall patch — large area / multiple holes",
    categoryName: "Prep & Repair",
    unitPriceCents: 40000,
    costCents: 14000,
  },
  {
    name: "Nail pop repair (each)",
    categoryName: "Prep & Repair",
    unitPriceCents: 3500,
    costCents: 1000,
  },
  {
    name: "Touch-up & minor repair painting",
    categoryName: "Prep & Repair",
    unitPriceCents: 3500,
    costCents: 1200,
    measuredBy: "hour",
  },
];

export const PAINTING_PRICEBOOK: TradePricebook = {
  key: "painting",
  categories: PAINTING_CATEGORIES,
  services: PAINTING_SERVICES,
  sources: [
    "https://www.angi.com/articles/how-much-does-it-cost-paint-interior-house.htm",
    "https://www.homeadvisor.com/cost/painting/paint-a-home-interior/",
    "https://homeguide.com/costs/cost-to-paint-a-ceiling",
    "https://homeguide.com/costs/wallpaper-removal-cost",
    "https://www.homewyse.com/services/cost_to_remove_popcorn_ceiling_texture.html",
    "https://homeguide.com/costs/cost-to-paint-trim-baseboards",
    "https://www.angi.com/articles/paint-trim-cost.htm",
    "https://homeguide.com/costs/cost-to-paint-exterior-of-house",
    "https://www.homeadvisor.com/cost/painting/powerwash-exterior-surfaces/",
    "https://homeguide.com/costs/cost-to-paint-kitchen-cabinets",
    "https://www.angi.com/articles/how-much-does-it-cost-paint-kitchen-cabinets.htm",
    "https://homeguide.com/costs/drywall-repair-cost",
    "https://www.angi.com/articles/how-much-does-drywall-repair-cost-small-holes.htm",
    "https://www.homewyse.com/services/cost_to_repair_drywall_holes.html",
  ],
};
