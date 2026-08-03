import type { TradePricebook } from "./types";

/**
 * Starter pricebook for the "gutters" trade (Task 8-style one-click pack, same shape as the
 * plumbing seed at app/(office)/settings/pricebook-seed.ts). Pure data.
 *
 * MEASURED-UNIT CONVENTION: gutters sell by the linear foot, not the square — every
 * `measuredBy: "site_lnft"` line here is priced PER LINEAR FOOT. A $9/ft aluminum gutter quote
 * is `unitPriceCents: 900`, i.e. $9.00/ft. Per-unit fixtures (a downspout extension, an
 * underground drainage run) and labor-only visits (cleaning, resecuring a section) are
 * genuinely per-job and left flat (`measuredBy` undefined).
 *
 * `costCents` is the shop's own cost (materials + labor burden), same per-unit basis as the
 * price, not the customer price. Every figure below is the midpoint of a national 2025/2026
 * market-rate range — see `sources`.
 *
 * Money: integer cents, matching CreateServiceCommand/DTO.
 */
export const GUTTERS_PRICEBOOK: TradePricebook = {
  key: "gutters",

  categories: [
    "Repairs & Maintenance",
    "Seamless Aluminum Gutters",
    "Copper & Steel Gutters",
    "Gutter Guards",
    "Downspouts & Drainage",
  ],

  services: [
    // ── Repairs & Maintenance — mostly flat, one linear-foot repair-scale line ──
    {
      name: "Gutter seam repair / reseal",
      categoryName: "Repairs & Maintenance",
      unitPriceCents: 22500,
      costCents: 5600,
    },
    {
      name: "Gutter resecure / re-hang — sagging section",
      categoryName: "Repairs & Maintenance",
      unitPriceCents: 32500,
      costCents: 9800,
    },
    {
      name: "Gutter reslope / re-pitch adjustment",
      categoryName: "Repairs & Maintenance",
      unitPriceCents: 17000,
      costCents: 5100,
    },
    {
      name: "Gutter section replacement (repair-scale)",
      categoryName: "Repairs & Maintenance",
      unitPriceCents: 1150,
      costCents: 460,
      measuredBy: "site_lnft",
    },
    {
      name: "Gutter cleaning — single-story home",
      categoryName: "Repairs & Maintenance",
      unitPriceCents: 13500,
      costCents: 3400,
    },
    {
      name: "Gutter cleaning — two-story home",
      categoryName: "Repairs & Maintenance",
      unitPriceCents: 19000,
      costCents: 4800,
    },

    // ── Seamless Aluminum Gutters — priced PER LINEAR FOOT (site_lnft) ──────────
    {
      name: 'Seamless aluminum gutter installation (5"/6")',
      categoryName: "Seamless Aluminum Gutters",
      unitPriceCents: 800,
      costCents: 400,
      measuredBy: "site_lnft",
    },
    {
      name: "Seamless aluminum gutter installation — 2-story+ height surcharge",
      categoryName: "Seamless Aluminum Gutters",
      unitPriceCents: 1000,
      costCents: 500,
      measuredBy: "site_lnft",
    },

    // ── Copper & Steel Gutters — priced PER LINEAR FOOT (site_lnft) ─────────────
    {
      name: "Copper gutter installation",
      categoryName: "Copper & Steel Gutters",
      unitPriceCents: 5000,
      costCents: 3250,
      measuredBy: "site_lnft",
    },
    {
      name: "Galvanized steel gutter installation",
      categoryName: "Copper & Steel Gutters",
      unitPriceCents: 1130,
      costCents: 570,
      measuredBy: "site_lnft",
    },

    // ── Gutter Guards — priced PER LINEAR FOOT (site_lnft) ──────────────────────
    {
      name: "Gutter guard — screen-style",
      categoryName: "Gutter Guards",
      unitPriceCents: 250,
      costCents: 110,
      measuredBy: "site_lnft",
    },
    {
      name: "Gutter guard — micro-mesh (premium)",
      categoryName: "Gutter Guards",
      unitPriceCents: 1200,
      costCents: 540,
      measuredBy: "site_lnft",
    },

    // ── Downspouts & Drainage — new runs measured, fixtures/extensions flat ─────
    {
      name: "Downspout installation (new)",
      categoryName: "Downspouts & Drainage",
      unitPriceCents: 300,
      costCents: 135,
      measuredBy: "site_lnft",
    },
    {
      name: "Downspout extension — above-ground, each",
      categoryName: "Downspouts & Drainage",
      unitPriceCents: 3000,
      costCents: 1200,
    },
    {
      name: "Underground downspout drainage extension, per downspout",
      categoryName: "Downspouts & Drainage",
      unitPriceCents: 25000,
      costCents: 11300,
    },
  ],

  sources: [
    "https://www.thisoldhouse.com/gutters/gutter-repair-cost",
    "https://www.gutterfx.com/resources/blog/gutter-repair-cost-guide",
    "https://www.thisoldhouse.com/gutters/gutter-cleaning-cost",
    "https://homeguide.com/costs/gutter-cleaning-cost",
    "https://homeguide.com/costs/seamless-gutters-cost",
    "https://www.thisoldhouse.com/gutters/seamless-gutters-cost",
    "https://modernize.com/gutters/types/copper",
    "https://www.angi.com/articles/copper-gutters-guide.htm",
    "https://modernize.com/gutters/types/galvanized-steel",
    "https://www.angi.com/articles/galvanized-steel-gutters-installation-cost.htm",
    "https://www.homeadvisor.com/cost/gutters/gutter-guards/",
    "https://www.angi.com/articles/cost-gutter-guards-worth-it.htm",
    "https://homeguide.com/costs/downspouts-cost",
    "https://www.angi.com/articles/cost-to-install-underground-gutter-drainage.htm",
    "https://home.costhelper.com/downspout-extension.html",
  ],
};
