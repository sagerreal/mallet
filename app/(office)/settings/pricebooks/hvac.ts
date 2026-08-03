/**
 * app/(office)/settings/pricebooks/hvac.ts
 * Starter pricebook for a residential HVAC shop. Pure data, no logic — composed into the
 * generic SeedPricebookUseCase by whichever router procedure seeds it, same pattern as
 * app/(office)/settings/pricebook-seed.ts (the plumbing pack).
 *
 * HVAC is a SERVICE trade: every line is a flat per-job price (no `measuredBy`). Figures are
 * the MIDPOINT of a national 2025/2026 range from the sources below, not invented. `costCents`
 * is the shop's own cost (materials + labor burden), not the customer price — see `sources`
 * for what backs each figure; a future editor should re-check rather than guess.
 *
 * Money: integer cents (unitPriceCents/costCents).
 */

import type { TradePricebook } from "./types";

export const HVAC_PRICEBOOK: TradePricebook = {
  key: "hvac",
  categories: [
    "Cooling",
    "Heating",
    "Ductwork & Air Quality",
    "Thermostats & Controls",
    "Maintenance",
    "Service & Diagnostic",
  ],
  services: [
    // ── Cooling ─────────────────────────────────────────────────────────────
    { name: "AC repair — diagnose & repair", categoryName: "Cooling", unitPriceCents: 35000, costCents: 18000 },
    { name: "Replace AC capacitor", categoryName: "Cooling", unitPriceCents: 32500, costCents: 15000 },
    { name: "Replace AC compressor", categoryName: "Cooling", unitPriceCents: 225000, costCents: 135000 },
    { name: "Replace AC evaporator coil", categoryName: "Cooling", unitPriceCents: 175000, costCents: 105000 },
    { name: "Recharge refrigerant (R-410A, up to 3lb)", categoryName: "Cooling", unitPriceCents: 65000, costCents: 30000 },
    { name: "Replace central AC system (up to 3-ton)", categoryName: "Cooling", unitPriceCents: 590000, costCents: 350000 },

    // ── Heating ─────────────────────────────────────────────────────────────
    { name: "Furnace repair — diagnose & repair", categoryName: "Heating", unitPriceCents: 30000, costCents: 13500 },
    { name: "Replace furnace ignitor", categoryName: "Heating", unitPriceCents: 27500, costCents: 12000 },
    { name: "Replace thermocouple", categoryName: "Heating", unitPriceCents: 20000, costCents: 9000 },
    { name: "Replace gas furnace (mid-efficiency)", categoryName: "Heating", unitPriceCents: 540000, costCents: 325000 },
    { name: "Heat pump repair — diagnose & repair", categoryName: "Heating", unitPriceCents: 45000, costCents: 20000 },
    { name: "Replace heat pump system (2.5–3 ton)", categoryName: "Heating", unitPriceCents: 1100000, costCents: 660000 },

    // ── Ductwork & Air Quality ──────────────────────────────────────────────
    { name: "Duct sealing (per system)", categoryName: "Ductwork & Air Quality", unitPriceCents: 85000, costCents: 38000 },
    { name: "Duct cleaning (whole system)", categoryName: "Ductwork & Air Quality", unitPriceCents: 45000, costCents: 20000 },

    // ── Thermostats & Controls ──────────────────────────────────────────────
    { name: "Install smart thermostat", categoryName: "Thermostats & Controls", unitPriceCents: 35000, costCents: 20000 },

    // ── Maintenance ─────────────────────────────────────────────────────────
    { name: "AC tune-up", categoryName: "Maintenance", unitPriceCents: 17500, costCents: 4500 },
    { name: "Furnace / heat pump tune-up", categoryName: "Maintenance", unitPriceCents: 15000, costCents: 4000 },
    { name: "Annual HVAC maintenance plan (2 visits/yr)", categoryName: "Maintenance", unitPriceCents: 27500, costCents: 8000 },

    // ── Service & Diagnostic ────────────────────────────────────────────────
    { name: "Diagnostic / trip fee", categoryName: "Service & Diagnostic", unitPriceCents: 15000, costCents: 6500 },
    { name: "Emergency after-hours call", categoryName: "Service & Diagnostic", unitPriceCents: 27500, costCents: 13000 },
    { name: "Refrigerant leak detection & repair", categoryName: "Service & Diagnostic", unitPriceCents: 100000, costCents: 45000 },
    { name: "Replace blower motor", categoryName: "Service & Diagnostic", unitPriceCents: 47500, costCents: 22000 },
  ],
  sources: [
    "https://homeguide.com/costs/hvac-repair-cost",
    "https://www.angi.com/articles/how-much-hvac-repair-cost.htm",
    "https://www.homeadvisor.com/cost/heating-and-cooling/repair-an-hvac-system",
    "https://www.homeadvisor.com/cost/heating-and-cooling/repair-an-ac-unit/",
    "https://www.angi.com/articles/how-much-does-installing-new-ac-cost.htm",
    "https://www.forbes.com/home-improvement/hvac/ac-installation-cost/",
    "https://homeguide.com/costs/new-furnace-replacement-cost",
    "https://www.homeadvisor.com/cost/heating-and-cooling/install-a-furnace",
    "https://hvacprojectcost.com/furnace-replacement-cost/",
    "https://homeguide.com/costs/ac-maintenance-tune-up-service-cost",
    "https://hvaccalculatorhub.com/blog/hvac-service-call-costs-2026",
    "https://rjgroner.com/hvac-diagnostic-fee/",
    "https://www.nearbyhunt.com/articles/hvac-maintenance-cost",
    "https://www.fixr.com/costs/heat-pump-repair",
    "https://rjgroner.com/heat-pump-repair-cost-2025-report/",
    "https://heatpumppriceguides.com/heat-pump-replacement-costs-this-year/",
    "https://www.avsheatingandair.com/hvac-cost/heat-pump-installation-cost/",
    "https://www.angi.com/articles/ductwork-installation-cost.htm",
    "https://www.angi.com/articles/how-much-does-air-duct-cleaning-cost.htm",
    "https://homeguide.com/costs/smart-thermostat-installation-cost",
    "https://homeguide.com/costs/r-410a-refrigerant-cost-per-pound",
    "https://www.acdirect.com/blog/r410a-cost-per-pound-2026/",
    "https://homeguide.com/costs/ac-capacitor-replacement-cost",
    "https://www.angi.com/articles/how-much-does-it-cost-replace-ac-capacitor.htm",
    "https://www.angi.com/articles/how-much-should-it-cost-replace-evaporator-coil.htm",
    "https://homeguide.com/costs/ac-evaporator-coil-replacement-cost",
    "https://homeguide.com/costs/furnace-repair-service-cost",
    "https://todayshomeowner.com/hvac/cost/furnace-ignitor-cost/",
    "https://www.angi.com/articles/how-much-does-common-furnace-repair-cost.htm",
  ],
};
