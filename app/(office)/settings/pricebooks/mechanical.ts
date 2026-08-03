/**
 * app/(office)/settings/pricebooks/mechanical.ts
 * Starter pricebook for a commercial / light-commercial mechanical shop — refrigeration
 * (walk-ins, reach-ins, ice machines), boilers & hydronics, and rooftop units (RTUs). This is
 * deliberately NOT residential HVAC (see hvac.ts); a restaurant's walk-in cooler and a
 * building's boiler plant are a different trade with different equipment and price points.
 * Pure data, no logic — composed into the generic SeedPricebookUseCase by whichever router
 * procedure seeds it, same pattern as app/(office)/settings/pricebook-seed.ts (the plumbing
 * pack).
 *
 * Mechanical is a SERVICE trade: every line is a flat per-job price (no `measuredBy`). Figures
 * are the MIDPOINT of a national 2025/2026 range from the sources below, not invented.
 * `costCents` is the shop's own cost (materials + labor burden), not the customer price — see
 * `sources` for what backs each figure; a future editor should re-check rather than guess.
 *
 * Money: integer cents (unitPriceCents/costCents).
 */

import type { TradePricebook } from "./types";

export const MECHANICAL_PRICEBOOK: TradePricebook = {
  key: "mechanical",
  categories: [
    "Refrigeration",
    "Boilers & Hydronics",
    "Rooftop Units",
    "Preventive Maintenance",
    "Service & Diagnostic",
  ],
  services: [
    // ── Refrigeration ───────────────────────────────────────────────────────
    { name: "Walk-in cooler/freezer repair — diagnose & repair", categoryName: "Refrigeration", unitPriceCents: 27500, costCents: 12000 },
    { name: "Walk-in door gasket / seal replacement", categoryName: "Refrigeration", unitPriceCents: 31500, costCents: 15000 },
    { name: "Walk-in compressor replacement", categoryName: "Refrigeration", unitPriceCents: 315000, costCents: 190000 },
    { name: "Condenser fan motor replacement", categoryName: "Refrigeration", unitPriceCents: 55000, costCents: 28000 },
    { name: "Reach-in cooler/freezer repair", categoryName: "Refrigeration", unitPriceCents: 90000, costCents: 45000 },
    { name: "Ice machine repair", categoryName: "Refrigeration", unitPriceCents: 75000, costCents: 35000 },
    { name: "Ice machine replacement (up to 500lb/day)", categoryName: "Refrigeration", unitPriceCents: 240000, costCents: 150000 },

    // ── Boilers & Hydronics ─────────────────────────────────────────────────
    { name: "Boiler repair — diagnose & repair", categoryName: "Boilers & Hydronics", unitPriceCents: 45000, costCents: 20000 },
    { name: "Circulator pump replacement", categoryName: "Boilers & Hydronics", unitPriceCents: 45000, costCents: 22000 },
    { name: "Boiler system flush", categoryName: "Boilers & Hydronics", unitPriceCents: 37500, costCents: 15000 },
    { name: "Boiler inspection", categoryName: "Boilers & Hydronics", unitPriceCents: 10000, costCents: 2000 },
    { name: "Commercial boiler replacement (small unit, like-for-like)", categoryName: "Boilers & Hydronics", unitPriceCents: 1350000, costCents: 800000 },

    // ── Rooftop Units ───────────────────────────────────────────────────────
    { name: "RTU repair — diagnose & repair", categoryName: "Rooftop Units", unitPriceCents: 80000, costCents: 35000 },
    { name: "RTU economizer actuator replacement", categoryName: "Rooftop Units", unitPriceCents: 50000, costCents: 22000 },
    { name: "RTU belt replacement", categoryName: "Rooftop Units", unitPriceCents: 25000, costCents: 8000 },
    { name: "RTU compressor replacement (3–5 ton)", categoryName: "Rooftop Units", unitPriceCents: 520000, costCents: 320000 },
    { name: "RTU replacement (packaged unit, 3–5 ton)", categoryName: "Rooftop Units", unitPriceCents: 950000, costCents: 570000 },

    // ── Preventive Maintenance ──────────────────────────────────────────────
    { name: "Refrigeration PM visit (per unit, quarterly)", categoryName: "Preventive Maintenance", unitPriceCents: 20000, costCents: 7000 },
    { name: "Commercial boiler annual maintenance (per unit)", categoryName: "Preventive Maintenance", unitPriceCents: 75000, costCents: 30000 },
    { name: "RTU preventive maintenance (annual contract, per unit)", categoryName: "Preventive Maintenance", unitPriceCents: 65000, costCents: 22000 },
    { name: "Ice machine cleaning / PM service", categoryName: "Preventive Maintenance", unitPriceCents: 15000, costCents: 5000 },

    // ── Service & Diagnostic ────────────────────────────────────────────────
    { name: "Diagnostic / trip fee (commercial)", categoryName: "Service & Diagnostic", unitPriceCents: 25000, costCents: 11000 },
    { name: "Emergency after-hours call", categoryName: "Service & Diagnostic", unitPriceCents: 45000, costCents: 21000 },
    { name: "Refrigerant leak detection & repair", categoryName: "Service & Diagnostic", unitPriceCents: 100000, costCents: 45000 },
  ],
  sources: [
    "https://1800coolaid.com/cost-to-repair-a-walk-in-cooler/",
    "https://samedayappliance.repair/price-list/walk-in-cooler-repair-cost/",
    "https://coolriteems.com/blog/ultimate-guide-to-commercial-walk-in-cooler-repair",
    "https://homeguide.com/costs/refrigerator-repair-cost",
    "https://easybear-appliancerepair.com/blog/refrigerator-condenser-fan-motor-replacement-cost",
    "https://coolriteems.com/pricing/",
    "https://homeguide.com/costs/ice-maker-repair-or-replacement-cost",
    "https://samedayappliance.repair/price-list/commercial-ice-machine-repair-cost/",
    "https://oxmaint.com/industries/hvac/boiler-replacement-cost-2026-commercial-pricing-btu-fuel-efficiency",
    "https://www.fixr.com/costs/repair-boiler",
    "https://homeguide.com/costs/boiler-service-cost",
    "https://mcquillanbros.com/blog/calculating-boiler-repair-cost-replacement-guide/",
    "https://www.plumbersstock.com/how-to-hvac/boilers/maintenance-costs.html",
    "https://oxmaint.com/industries/hvac/rtu-replacement-cost-2026-per-ton-pricing-install-labor-hidden-costs",
    "https://salmonhvac.com/blog/commercial-rtu-repair-vs-replacement-utah/",
    "https://www.pickcomfort.com/compressor-replacement-cost-typical-prices-ranges/",
    "https://northbreezehvac.com/blog/carrier-rtu-common-problems/",
    "https://oxmaint.com/industries/hvac/rooftop-unit-rtu-maintenance-cost-effective-pm-commercial-hvac",
    "https://northbreezehvac.com/services/commercial-refrigeration/maintenance-plans/",
    "https://www.servicetitan.com/blog/commercial-refrigeration-maintenance-contracts",
    "https://buffos-refrigeration.com/how-much-to-budget-for-refrigeration-maintenance/",
    "https://www.haroldbros.com/blog/commercial-hvac-preventative-maintenance-cost",
  ],
};
