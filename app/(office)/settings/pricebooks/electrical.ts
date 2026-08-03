/**
 * app/(office)/settings/pricebooks/electrical.ts
 * Starter pricebook for a residential + light-commercial electrical shop. Pure data, no logic —
 * composed into the generic SeedPricebookUseCase by whichever router procedure seeds it, same
 * pattern as app/(office)/settings/pricebook-seed.ts (the plumbing pack).
 *
 * Electrical is a SERVICE trade: every line is a flat per-job price (no `measuredBy`). Figures
 * are the MIDPOINT of a national 2025/2026 range from the sources below, not invented.
 * `costCents` is the shop's own cost (materials + labor burden), not the customer price — see
 * `sources` for what backs each figure; a future editor should re-check rather than guess.
 *
 * Money: integer cents (unitPriceCents/costCents).
 */

import type { TradePricebook } from "./types";

export const ELECTRICAL_PRICEBOOK: TradePricebook = {
  key: "electrical",
  categories: [
    "Panels & Service",
    "Wiring & Outlets",
    "Lighting & Fixtures",
    "EV & Generator",
    "Diagnostics & Repair",
    "Safety & Inspection",
  ],
  services: [
    // ── Panels & Service ────────────────────────────────────────────────────
    { name: "Upgrade to 200A panel", categoryName: "Panels & Service", unitPriceCents: 250000, costCents: 150000 },
    { name: "Install subpanel (up to 100A)", categoryName: "Panels & Service", unitPriceCents: 100000, costCents: 55000 },
    { name: "Replace standard circuit breaker", categoryName: "Panels & Service", unitPriceCents: 18000, costCents: 8000 },
    { name: "Replace AFCI/GFCI breaker", categoryName: "Panels & Service", unitPriceCents: 37500, costCents: 18500 },
    { name: "Replace main breaker", categoryName: "Panels & Service", unitPriceCents: 85000, costCents: 47000 },

    // ── Wiring & Outlets ────────────────────────────────────────────────────
    { name: "Install new outlet (existing circuit)", categoryName: "Wiring & Outlets", unitPriceCents: 25000, costCents: 10000 },
    { name: "Replace outlet", categoryName: "Wiring & Outlets", unitPriceCents: 14000, costCents: 5500 },
    { name: "Install GFCI outlet (replace existing)", categoryName: "Wiring & Outlets", unitPriceCents: 15000, costCents: 6500 },
    { name: "Install GFCI outlet (new circuit)", categoryName: "Wiring & Outlets", unitPriceCents: 27500, costCents: 12500 },
    { name: "Whole-house rewire (average size home)", categoryName: "Wiring & Outlets", unitPriceCents: 1500000, costCents: 900000 },

    // ── Lighting & Fixtures ─────────────────────────────────────────────────
    { name: "Install light fixture (existing wiring)", categoryName: "Lighting & Fixtures", unitPriceCents: 25000, costCents: 10000 },
    { name: "Install ceiling fan (existing wiring)", categoryName: "Lighting & Fixtures", unitPriceCents: 20000, costCents: 8000 },
    { name: "Install ceiling fan (new switch wiring)", categoryName: "Lighting & Fixtures", unitPriceCents: 45000, costCents: 19000 },
    { name: "Install recessed light (per fixture)", categoryName: "Lighting & Fixtures", unitPriceCents: 19000, costCents: 7500 },

    // ── EV & Generator ──────────────────────────────────────────────────────
    { name: "Install Level 2 EV charger", categoryName: "EV & Generator", unitPriceCents: 170000, costCents: 95000 },
    { name: "Install whole-house standby generator", categoryName: "EV & Generator", unitPriceCents: 1200000, costCents: 720000 },
    { name: "Install manual transfer switch (up to 10-circuit)", categoryName: "EV & Generator", unitPriceCents: 160000, costCents: 88000 },

    // ── Diagnostics & Repair ────────────────────────────────────────────────
    { name: "Electrical troubleshooting / diagnostic", categoryName: "Diagnostics & Repair", unitPriceCents: 15000, costCents: 6500 },
    { name: "Emergency after-hours call", categoryName: "Diagnostics & Repair", unitPriceCents: 27500, costCents: 13000 },
    { name: "Repair dead outlet or switch", categoryName: "Diagnostics & Repair", unitPriceCents: 15000, costCents: 5000 },

    // ── Safety & Inspection ─────────────────────────────────────────────────
    { name: "Electrical safety inspection", categoryName: "Safety & Inspection", unitPriceCents: 25000, costCents: 6000 },
    { name: "Install whole-house surge protector", categoryName: "Safety & Inspection", unitPriceCents: 32500, costCents: 16000 },
    { name: "Install hardwired smoke detector (per unit)", categoryName: "Safety & Inspection", unitPriceCents: 11500, costCents: 3500 },
  ],
  sources: [
    "https://homeguide.com/costs/cost-to-replace-electrical-panel",
    "https://www.thisoldhouse.com/electrical/cost-to-upgrade-electrical-panel",
    "https://vonselectric.com/articles/200-amp-panel-upgrade-cost/",
    "https://homeguide.com/costs/cost-to-install-a-subpanel",
    "https://homeguide.com/costs/cost-to-replace-a-circuit-breaker-switch",
    "https://drwattselectric.com/circuit-breaker-replacement-cost/",
    "https://homeguide.com/costs/electrician-cost-per-hour",
    "https://www.housecallpro.com/resources/how-to-price-electrical-work/",
    "https://www.homewyse.com/services/cost_to_install_gfci_outlet.html",
    "https://www.homeadvisor.com/cost/electrical/gfci-outlet-cost",
    "https://homeguide.com/costs/cost-to-rewire-a-house",
    "https://www.angi.com/articles/how-much-does-it-cost-rewire-house.htm",
    "https://homeguide.com/costs/lighting-fixture-installation-cost",
    "https://www.homeadvisor.com/cost/heating-and-cooling/install-a-ceiling-fan/",
    "https://www.cansandfans.com/blog/recessed-lighting-installation-cost-in-2026/",
    "https://qmerit.com/blog/understanding-your-ev-home-charging-station-costs-for-installation/",
    "https://www.angi.com/articles/how-much-does-it-cost-install-generator.htm",
    "https://homeguide.com/costs/generator-cost",
    "https://homeguide.com/costs/generator-transfer-switch-installation-cost",
    "https://breakerhunters.com/blogs/news/generator-interlock-kits-vs-transfer-switches-2025-buyer-s-guide",
    "https://homeguide.com/costs/electrical-inspection-cost",
    "https://homeguide.com/costs/whole-house-surge-protector-cost",
    "https://homeguide.com/costs/smoke-detector-installation-cost",
    "https://www.angi.com/articles/smoke-detector-installation-cost.htm",
  ],
};
