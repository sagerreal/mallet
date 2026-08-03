import type { TradePricebook } from "./types";

/**
 * Starter pricebook for the "siding" trade (Task 8-style one-click pack, same shape as the
 * plumbing seed at app/(office)/settings/pricebook-seed.ts). Pure data.
 *
 * MEASURED-UNIT CONVENTION: like roofing, siding is often quoted by the "square" (100 sq ft)
 * in the trade, but every `measuredBy: "site_sqft"` line here is priced PER SQUARE FOOT —
 * divide a per-square quote by 100 before entering it (a $650/square vinyl job is
 * `unitPriceCents: 650`, i.e. $6.50/sq ft, not 65000). Linear-run trim items (fascia, soffit,
 * caulking) use `site_lnft` and are priced per linear foot instead.
 *
 * `costCents` is the shop's own cost (materials + labor burden), same per-unit basis as the
 * price, not the customer price. Every figure below is the midpoint of a national 2025/2026
 * market-rate range — see `sources`.
 *
 * Money: integer cents, matching CreateServiceCommand/DTO.
 */
export const SIDING_PRICEBOOK: TradePricebook = {
  key: "siding",

  categories: [
    "Repairs",
    "Vinyl Siding",
    "Fiber Cement Siding",
    "Wood & Engineered Wood Siding",
    "Inspections & Weatherproofing",
  ],

  services: [
    // ── Repairs (flat, per job) ────────────────────────────────────────────────
    {
      name: "Siding repair — vinyl panel patch/replace",
      categoryName: "Repairs",
      unitPriceCents: 40000,
      costCents: 10000,
    },
    {
      name: "Siding repair — wood section replacement",
      categoryName: "Repairs",
      unitPriceCents: 60000,
      costCents: 18000,
    },
    {
      name: "Siding repair — fiber cement section replacement",
      categoryName: "Repairs",
      unitPriceCents: 80000,
      costCents: 24000,
    },
    {
      name: "Siding repair — major storm/moisture damage (multi-section)",
      categoryName: "Repairs",
      unitPriceCents: 325000,
      costCents: 113750,
    },

    // ── Vinyl Siding — priced PER SQ FT (site_sqft), see header ─────────────────
    {
      name: "Vinyl siding installation — standard",
      categoryName: "Vinyl Siding",
      unitPriceCents: 635,
      costCents: 320,
      measuredBy: "site_sqft",
    },
    {
      name: "Vinyl siding installation — premium/insulated",
      categoryName: "Vinyl Siding",
      unitPriceCents: 1075,
      costCents: 540,
      measuredBy: "site_sqft",
    },

    // ── Fiber Cement Siding — priced PER SQ FT (site_sqft) ──────────────────────
    {
      name: "Fiber cement lap siding installation — standard profile",
      categoryName: "Fiber Cement Siding",
      unitPriceCents: 950,
      costCents: 520,
      measuredBy: "site_sqft",
    },
    {
      name: "Fiber cement lap siding installation — premium/architectural profile",
      categoryName: "Fiber Cement Siding",
      unitPriceCents: 1350,
      costCents: 740,
      measuredBy: "site_sqft",
    },

    // ── Wood & Engineered Wood Siding — priced PER SQ FT (site_sqft) ────────────
    {
      name: "Cedar wood siding installation",
      categoryName: "Wood & Engineered Wood Siding",
      unitPriceCents: 1450,
      costCents: 800,
      measuredBy: "site_sqft",
    },
    {
      name: "Engineered wood siding installation (LP SmartSide-type)",
      categoryName: "Wood & Engineered Wood Siding",
      unitPriceCents: 675,
      costCents: 370,
      measuredBy: "site_sqft",
    },

    // ── Inspections & Weatherproofing — mixed: linear-foot runs measured, visit flat ─
    {
      name: "Siding inspection / storm damage assessment",
      categoryName: "Inspections & Weatherproofing",
      unitPriceCents: 20000,
      costCents: 4000,
    },
    {
      name: "House wrap / weather barrier installation",
      categoryName: "Inspections & Weatherproofing",
      unitPriceCents: 105,
      costCents: 70,
      measuredBy: "site_sqft",
    },
    {
      name: "Fascia board replacement",
      categoryName: "Inspections & Weatherproofing",
      unitPriceCents: 1460,
      costCents: 800,
      measuredBy: "site_lnft",
    },
    {
      name: "Soffit replacement",
      categoryName: "Inspections & Weatherproofing",
      unitPriceCents: 275,
      costCents: 150,
      measuredBy: "site_lnft",
    },
    {
      name: "Exterior caulking & sealing — perimeter",
      categoryName: "Inspections & Weatherproofing",
      unitPriceCents: 320,
      costCents: 130,
      measuredBy: "site_lnft",
    },
  ],

  sources: [
    "https://homeguide.com/costs/siding-repair-cost",
    "https://www.angi.com/articles/how-much-cost-repair-siding.htm",
    "https://homewyse.com/services//cost_to_install_vinyl_siding.html",
    "https://www.landmarkroof.com/news/vinyl-siding-cost-per-square-foot",
    "https://homeguide.com/costs/fiber-cement-siding-cost",
    "https://www.angi.com/articles/cost-of-hardie-board-siding.htm",
    "https://homeguide.com/costs/wood-siding-cost-to-install-or-replace",
    "https://sidingcosts.com/lp-smart-siding-cost/",
    "https://www.homewyse.com/services/cost_to_install_house_wrap.html",
    "https://homeguide.com/costs/soffit-and-fascia-replacement-cost",
    "https://www.angi.com/articles/fascia-cost.htm",
    "https://www.homewyse.com/services/cost_to_caulk_perimeter_of_home.html",
    "https://www.angi.com/articles/cost-to-caulk.htm",
  ],
};
