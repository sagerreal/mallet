/**
 * app/(office)/settings/pricebooks/hvac.ts
 * Starter pricebook for a residential HVAC shop. Pure data, no logic — composed into the
 * generic SeedPricebookUseCase by whichever router procedure seeds it, same pattern as
 * app/(office)/settings/pricebook-seed.ts (the plumbing pack).
 *
 * HVAC is a SERVICE trade: every line is a flat per-job price (no `measuredBy`). Prices sit
 * inside a published national 2025/2026 range, not invented — see `sources`.
 *
 * COST FLOOR (read before editing any costCents). `costCents` is what the job costs the SHOP:
 * the visit + wrench time + parts. This pack costs a visit at $65.00 (the `Diagnostic / trip
 * fee` line), which is one loaded technician hour including drive time, so NO line may cost
 * less than $65.00 — a tune-up cannot be cheaper to deliver than the truck roll it requires.
 * The short-visit lines here were originally costed at parts only ($40-$45 against a $150-$175
 * tune-up), which rendered a ~74% margin in the app and would have had a shop price its next
 * job off a number that was never real. Prices were left alone; the costs were the lie.
 *
 * SOURCES. Every URL below returned a live page when last checked (2026-08-02). Where a line
 * has no source it is marked `// uncited` inline: that is the shop's number to set first, and a
 * future editor should not read the presence of this array as backing it. Two entries are
 * deliberately not price authorities and are labelled where they sit: acdirect.com is a
 * refrigerant retailer (wholesale COST side only) and hvaccalculatorhub.com is an SEO cost
 * calculator kept solely because it is the only after-hours multiplier found.
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
    // Priced at HomeGuide's $250 average rather than the $300-$600 flat-rate band, deliberately:
    // a capacitor swap is the most common sub-case of the generic AC repair line above, and at
    // $325 the two sat $25 apart and were functionally the same button in the catalogue.
    { name: "Replace AC capacitor", categoryName: "Cooling", unitPriceCents: 25000, costCents: 15000 },
    // $1,800: above the $1,550 national average (This Old House, $800-$2,300) to reflect a
    // flat-rate shop, but no longer sitting at the very top of the published band.
    { name: "Replace AC compressor", categoryName: "Cooling", unitPriceCents: 180000, costCents: 108000 },
    // Warranty status is the single biggest driver here (HomeGuide splits $1,000-$2,500 under
    // warranty vs $2,500-$4,500+ out), so it is two lines. Picking the wrong one is a 2x error.
    { name: "Replace AC evaporator coil (under warranty)", categoryName: "Cooling", unitPriceCents: 175000, costCents: 105000 },
    { name: "Replace AC evaporator coil (out of warranty)", categoryName: "Cooling", unitPriceCents: 330000, costCents: 198000 },
    // Scope is in the name on purpose: the cited per-pound source covers only the refrigerant
    // ($50-$100/lb installed, so $150-$300 for 3lb). The rest of this price is the visit, leak
    // check, recovery and evacuation. NOTE: R-410A ONLY — equipment built since Jan 2025 ships
    // A2L (R-454B / R-32) and needs its own line, which the shop must price itself.
    { name: "Recharge refrigerant — R-410A up to 3lb (incl. leak check & evacuation)", categoryName: "Cooling", unitPriceCents: 50000, costCents: 30000 },
    // Moved out of Service & Diagnostic (which is the fees bucket) — this is a Cooling job.
    { name: "Refrigerant leak detection & repair", categoryName: "Cooling", unitPriceCents: 100000, costCents: 48000 }, // uncited
    { name: "Clear condensate drain line", categoryName: "Cooling", unitPriceCents: 19500, costCents: 11000 }, // uncited
    { name: "Replace central AC system (up to 3-ton)", categoryName: "Cooling", unitPriceCents: 590000, costCents: 350000 },
    // SINGLE ZONE. Bob Vila: mini-split installs average $3,000, single-zone $2,000-$8,800.
    // A multi-zone job is several times this — do not quote one off this line.
    { name: "Install ductless mini-split (single zone)", categoryName: "Cooling", unitPriceCents: 350000, costCents: 200000 },

    // ── Heating ─────────────────────────────────────────────────────────────
    { name: "Furnace repair — diagnose & repair", categoryName: "Heating", unitPriceCents: 30000, costCents: 16000 },
    { name: "Replace furnace ignitor", categoryName: "Heating", unitPriceCents: 27500, costCents: 16000 },
    { name: "Replace thermocouple", categoryName: "Heating", unitPriceCents: 20000, costCents: 12000 }, // uncited
    // Two lines, not one. This Old House puts PSC at $300-$1,100 installed and variable-speed
    // ECM at $600-$1,500 — roughly 2x apart, so a single flat number loses money on every ECM
    // job. Moved here from Service & Diagnostic; this is an air-handler job, not a fee.
    { name: "Replace blower motor (PSC)", categoryName: "Heating", unitPriceCents: 75000, costCents: 40000 },
    { name: "Replace blower motor (variable-speed ECM)", categoryName: "Heating", unitPriceCents: 115000, costCents: 63000 },
    { name: "Replace gas furnace (mid-efficiency)", categoryName: "Heating", unitPriceCents: 540000, costCents: 325000 },
    { name: "Heat pump repair — diagnose & repair", categoryName: "Heating", unitPriceCents: 45000, costCents: 22000 },
    // $8,700 against Fixr's $8,350 national average for a 3-ton air-source heat pump
    // ($5,000-$15,000). The previous $11,000 was 1.9x this pack's own AC replacement line;
    // the real heat-pump premium over AC-only is nearer 30-50%.
    { name: "Replace heat pump system (2.5–3 ton)", categoryName: "Heating", unitPriceCents: 870000, costCents: 522000 },

    // ── Ductwork & Air Quality ──────────────────────────────────────────────
    // MANUAL / MASTIC sealing of an accessible system, priced as a whole job. Aerosol (Aeroseal)
    // runs roughly 2x this and is NOT covered by this line — the shop must add its own.
    { name: "Duct sealing — manual/mastic (per system)", categoryName: "Ductwork & Air Quality", unitPriceCents: 115000, costCents: 60000 }, // uncited
    { name: "Duct cleaning (whole system)", categoryName: "Ductwork & Air Quality", unitPriceCents: 45000, costCents: 24000 },
    // The only air-quality line in a category named for it. Bob Vila puts an extended media
    // filter at $400-$700 including professional installation.
    { name: "Install whole-house media filter cabinet", categoryName: "Ductwork & Air Quality", unitPriceCents: 65000, costCents: 35000 },

    // ── Thermostats & Controls ──────────────────────────────────────────────
    { name: "Install smart thermostat", categoryName: "Thermostats & Controls", unitPriceCents: 35000, costCents: 20000 },

    // ── Maintenance ─────────────────────────────────────────────────────────
    // Costs here are the visit ($65) plus wrench time, NOT the filter and coil cleaner. See the
    // COST FLOOR note at the top of this file before lowering either of them.
    { name: "AC tune-up", categoryName: "Maintenance", unitPriceCents: 17500, costCents: 10000 },
    { name: "Furnace / heat pump tune-up", categoryName: "Maintenance", unitPriceCents: 15000, costCents: 9000 },
    // ONE VISIT, BOTH SYSTEMS — this replaces an "Annual maintenance plan (2 visits/yr)" line.
    // The app models strictly one-off jobs (no memberships or recurring routes — deliberate), so
    // a plan line booked a full year of revenue against a single job and left the second visit
    // as revenue with no dispatch behind it. Priced as the spring/fall both-systems call, which
    // is a real one-off job and a small discount on the two tune-ups bought separately.
    { name: "Precision tune-up — AC & furnace (one visit, both systems)", categoryName: "Maintenance", unitPriceCents: 27500, costCents: 15500 },

    // ── Service & Diagnostic ────────────────────────────────────────────────
    // Fees ONLY, as in the plumbing pack. Real repair jobs belong in Cooling or Heating.
    // This trip fee's cost is the floor every other line in this file is measured against.
    { name: "Diagnostic / trip fee", categoryName: "Service & Diagnostic", unitPriceCents: 15000, costCents: 6500 },
    { name: "Emergency after-hours call", categoryName: "Service & Diagnostic", unitPriceCents: 27500, costCents: 13000 },
  ],
  sources: [
    // General HVAC repair / service call
    "https://homeguide.com/costs/hvac-repair-cost",
    "https://www.angi.com/articles/how-much-hvac-repair-cost.htm",
    "https://www.homeadvisor.com/cost/heating-and-cooling/repair-an-hvac-system",
    // Cooling — repair, capacitor, compressor, coil, refrigerant
    "https://www.homeadvisor.com/cost/heating-and-cooling/repair-an-ac-unit/",
    "https://www.fixr.com/costs/air-conditioner-repair",
    "https://homeguide.com/costs/ac-capacitor-replacement-cost",
    "https://www.angi.com/articles/how-much-does-it-cost-replace-ac-capacitor.htm",
    "https://www.thisoldhouse.com/heating-cooling/reviews/ac-compressor-cost",
    "https://www.angi.com/articles/how-much-should-it-cost-replace-evaporator-coil.htm",
    "https://homeguide.com/costs/ac-evaporator-coil-replacement-cost",
    "https://homeguide.com/costs/r-410a-refrigerant-cost-per-pound",
    // COST SIDE ONLY — refrigerant retailer quoting wholesale jug pricing, not a customer price.
    "https://www.acdirect.com/blog/r410a-cost-per-pound-2026/",
    // Cooling — system replacement and mini-split
    "https://www.angi.com/articles/how-much-does-installing-new-ac-cost.htm",
    "https://www.forbes.com/home-improvement/hvac/ac-installation-cost/",
    "https://www.bobvila.com/articles/ductless-mini-split-cost/",
    // Heating — furnace, ignitor, blower motor
    "https://homeguide.com/costs/new-furnace-replacement-cost",
    "https://www.homeadvisor.com/cost/heating-and-cooling/install-a-furnace",
    "https://homeguide.com/costs/furnace-repair-service-cost",
    "https://www.homeadvisor.com/cost/heating-and-cooling/repair-a-furnace/",
    "https://www.angi.com/articles/how-much-does-common-furnace-repair-cost.htm",
    "https://todayshomeowner.com/hvac/cost/furnace-ignitor-cost/",
    "https://www.thisoldhouse.com/heating-cooling/reviews/furnace-blower-motor-cost",
    // Heat pumps
    "https://www.fixr.com/costs/heat-pump-installation",
    "https://www.homeadvisor.com/cost/heating-and-cooling/install-a-heat-pump/",
    "https://www.thisoldhouse.com/heating-cooling/reviews/heat-pump-cost",
    "https://www.carrier.com/us/en/residential/hvac-resources/heat-pumps/how-much-does-a-heat-pump-cost/",
    "https://www.fixr.com/costs/heat-pump-repair",
    "https://www.homeadvisor.com/cost/heating-and-cooling/repair-a-heat-pump/",
    // Ductwork & air quality
    "https://www.angi.com/articles/how-much-does-air-duct-cleaning-cost.htm",
    "https://www.fixr.com/costs/air-duct-cleaning",
    "https://www.bobvila.com/articles/whole-house-air-purifier-cost/",
    // Thermostats
    "https://homeguide.com/costs/smart-thermostat-installation-cost",
    // Maintenance
    "https://homeguide.com/costs/ac-maintenance-tune-up-service-cost",
    // SECONDARY — SEO cost calculator, kept only for the after-hours multiplier (1.5-2x), for
    // which nothing better was found. Do not use it to justify any other line.
    "https://hvaccalculatorhub.com/blog/hvac-service-call-costs-2026",
  ],
};
