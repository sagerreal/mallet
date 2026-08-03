import type { TradePricebook } from "./types";

/**
 * Starter pricebook for the "roofing" trade (Task 8-style one-click pack, same shape as the
 * plumbing seed at app/(office)/settings/pricebook-seed.ts). Pure data.
 *
 * MEASURED-UNIT CONVENTION: roofing sells by the "square" (100 sq ft) as trade shorthand, but
 * `unitPriceCents` on every `measuredBy: "site_sqft"` line here is PER SQUARE FOOT, not per
 * square — divide the trade's per-square quote by 100 before entering it. Worked example: a
 * roofer who quotes "$450/square" for tear-off-and-replace means $4.50/sq ft, i.e.
 * `unitPriceCents: 450` (450 cents = $4.50), NOT 45000. A factor-of-100 slip here would quote a
 * $200,000 roof as $2,000,000 or vice versa.
 *
 * `costCents` is the shop's own cost (materials + labor burden), same per-unit basis as the
 * price, not the customer price. Every figure below is the midpoint of a national 2025/2026
 * market-rate range — see `sources`.
 *
 * Money: integer cents, matching CreateServiceCommand/DTO.
 */
export const ROOFING_PRICEBOOK: TradePricebook = {
  key: "roofing",

  categories: [
    "Repairs",
    "Shingle Roofing",
    "Metal Roofing",
    "Flat & Low-Slope Roofing",
    "Inspections & Diagnostics",
    "Ventilation & Add-ons",
  ],

  services: [
    // ── Repairs (flat, per job) ────────────────────────────────────────────────
    {
      name: "Roof leak repair — minor (few shingles)",
      categoryName: "Repairs",
      unitPriceCents: 35000,
      costCents: 9000,
    },
    {
      name: "Flashing repair — chimney or valley",
      categoryName: "Repairs",
      unitPriceCents: 37500,
      costCents: 9500,
    },
    {
      name: "Shingle repair — small area patch",
      categoryName: "Repairs",
      unitPriceCents: 40000,
      costCents: 10000,
    },
    {
      name: "Roof leak repair — moderate (flashing + shingles)",
      categoryName: "Repairs",
      unitPriceCents: 75000,
      costCents: 19000,
    },

    // ── Shingle Roofing — priced PER SQ FT (site_sqft), see header ─────────────
    {
      name: "Tear-off & replace — architectural/dimensional shingle",
      categoryName: "Shingle Roofing",
      unitPriceCents: 600,
      costCents: 330,
      measuredBy: "site_sqft",
    },
    {
      name: "Tear-off & replace — 3-tab shingle (economy)",
      categoryName: "Shingle Roofing",
      unitPriceCents: 450,
      costCents: 250,
      measuredBy: "site_sqft",
    },
    {
      name: "Roof recover — shingle overlay (no tear-off)",
      categoryName: "Shingle Roofing",
      unitPriceCents: 475,
      costCents: 260,
      measuredBy: "site_sqft",
    },

    // ── Metal Roofing — priced PER SQ FT (site_sqft) ────────────────────────────
    {
      name: "Standing seam metal roof — steel/aluminum",
      categoryName: "Metal Roofing",
      unitPriceCents: 1350,
      costCents: 740,
      measuredBy: "site_sqft",
    },
    {
      name: "Standing seam metal roof — copper (premium)",
      categoryName: "Metal Roofing",
      unitPriceCents: 3000,
      costCents: 1650,
      measuredBy: "site_sqft",
    },
    {
      name: "Exposed-fastener corrugated metal panel roof",
      categoryName: "Metal Roofing",
      unitPriceCents: 750,
      costCents: 410,
      measuredBy: "site_sqft",
    },

    // ── Flat & Low-Slope Roofing — priced PER SQ FT (site_sqft) ─────────────────
    {
      name: "TPO membrane roof installation",
      categoryName: "Flat & Low-Slope Roofing",
      unitPriceCents: 900,
      costCents: 450,
      measuredBy: "site_sqft",
    },
    {
      name: "EPDM rubber membrane roof installation",
      categoryName: "Flat & Low-Slope Roofing",
      unitPriceCents: 800,
      costCents: 400,
      measuredBy: "site_sqft",
    },

    // ── Inspections & Diagnostics (flat, per job) ──────────────────────────────
    {
      name: "Roof inspection — visual",
      categoryName: "Inspections & Diagnostics",
      unitPriceCents: 25000,
      costCents: 6000,
    },
    {
      name: "Roof inspection — drone/aerial",
      categoryName: "Inspections & Diagnostics",
      unitPriceCents: 27500,
      costCents: 6900,
    },

    // ── Ventilation & Add-ons — mixed: linear-foot runs measured, unit items flat ─
    {
      name: "Ridge vent installation",
      categoryName: "Ventilation & Add-ons",
      unitPriceCents: 1100,
      costCents: 600,
      measuredBy: "site_lnft",
    },
    {
      name: "Roof vent installation — turbine or box, each",
      categoryName: "Ventilation & Add-ons",
      unitPriceCents: 15000,
      costCents: 6800,
    },
    {
      name: "Pipe boot / vent flashing replacement, each",
      categoryName: "Ventilation & Add-ons",
      unitPriceCents: 40000,
      costCents: 12000,
    },
    {
      name: "Skylight replacement (existing opening)",
      categoryName: "Ventilation & Add-ons",
      unitPriceCents: 160000,
      costCents: 88000,
    },
    {
      name: "Ice & water shield upgrade — eaves & valleys",
      categoryName: "Ventilation & Add-ons",
      unitPriceCents: 225,
      costCents: 140,
      measuredBy: "site_sqft",
    },
    {
      name: "Drip edge installation — existing roof",
      categoryName: "Ventilation & Add-ons",
      unitPriceCents: 700,
      costCents: 400,
      measuredBy: "site_lnft",
    },
  ],

  sources: [
    "https://www.billraganroofing.com/blog/how-much-architectural-asphalt-shingle-roof-cost",
    "https://odonnellroofingco.com/blog/asphalt-shingle-roof-cost/",
    "https://www.mrroof.com/blog/roof-overlay-vs-tear-off-the-truth-about-costs-2025-guide/",
    "https://www.thisoldhouse.com/roofing/standing-seam-metal-roof-cost",
    "https://www.homeadvisor.com/cost/roofing/standing-seam-metal-roof",
    "https://www.westernstatesmetalroofing.com/metal-roof-cost",
    "https://www.schoenherrroofing.com/blog/2025-tpo-roofing-cost-value-pros-cons/",
    "https://www.angi.com/articles/epdm-roofing-cost.htm",
    "https://www.angi.com/articles/cost-to-repair-asphalt-shingles.htm",
    "https://roofrivercity.com/roof-leak-repair-cost/",
    "https://listwithclever.com/real-estate-blog/how-much-does-a-roof-inspection-cost/",
    "https://www.homeadvisor.com/cost/inspectors-and-appraisers/hire-a-roof-inspector/",
    "https://homeguide.com/costs/cost-to-install-roof-vent",
    "https://roofgnome.com/blog/cost/roof-vent-price/",
    "https://myheritageroofing.com/boot-camp-for-your-roof-a-vent-replacement-guide/",
    "https://homeguide.com/costs/skylight-installation-cost",
    "https://realcostiq.com/roof-underlayment-calculator/",
    "https://homeguide.com/costs/drip-edge-cost",
  ],
};
