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
 * TWO RULES A FUTURE EDITOR MUST NOT BREAK:
 *
 * 1. COST FLOOR. No line's `costCents` may fall below this pack's own trip-fee cost (11000 =
 *    $110, one loaded technician hour including drive), because nothing here is delivered
 *    without a truck roll. Parts and additional wrench time stack ON TOP of that floor. A
 *    short-visit line costed at materials only reports a fake margin in the app's live margin
 *    readout, and the shop then prices the next job down on the strength of it.
 * 2. NO "PER UNIT" IN A NAME THAT THE SCHEMA CANNOT ENFORCE. `pricebook_items.measured_by`
 *    (shared/db/schema/pricebook-items.ts) admits only hour / walls_sqft / ceiling_sqft /
 *    baseboard_lnft / crown_lnft / doors_count / windows_count / site_sqft / site_lnft — there
 *    is NO equipment-count unit. A flat line named "per unit" reads as a whole-building price
 *    on the quote. Name these lines so the office knows to enter a quantity by hand.
 *
 * SOURCE SCOPE. Every source below is commercial-scope unless marked otherwise in the trailing
 * comment. Residential pages were removed in the Aug 2026 audit: they were being cited for
 * commercial lines priced 2.5x–7.5x above what those pages actually show.
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
    // Below the walk-in line ON PURPOSE: a reach-in is the smallest box in the catalogue, so it
    // cannot cost more to fix. Homeyou 2026 metro averages for commercial refrigeration repair
    // run $237–$307 (Richmond → Los Angeles); $260 sits mid-band.
    { name: "Reach-in cooler/freezer repair — diagnose & repair", categoryName: "Refrigeration", unitPriceCents: 26000, costCents: 12000 },
    { name: "Walk-in door gasket / seal replacement", categoryName: "Refrigeration", unitPriceCents: 31500, costCents: 15000 },
    { name: "Walk-in compressor replacement", categoryName: "Refrigeration", unitPriceCents: 315000, costCents: 190000 },
    { name: "Condenser fan motor replacement", categoryName: "Refrigeration", unitPriceCents: 55000, costCents: 28000 },
    // Distinct from the condenser motor above — the evaporator motor lives inside the box.
    { name: "Evaporator fan motor replacement", categoryName: "Refrigeration", unitPriceCents: 50000, costCents: 24000 },
    // The most common walk-in FREEZER failure; coolriteems prices the timer/heater at $280–620.
    { name: "Defrost timer / heater replacement", categoryName: "Refrigeration", unitPriceCents: 45000, costCents: 20000 },
    { name: "TXV / expansion valve replacement", categoryName: "Refrigeration", unitPriceCents: 92500, costCents: 42000 },
    { name: "Ice machine repair", categoryName: "Refrigeration", unitPriceCents: 75000, costCents: 35000 },
    // Price is the ALL-IN installed system (modular head + bin + filtration + install), which is
    // how this is actually sold — $5,000–10,000 in 2026, so $7,000 is the midpoint. The bare head
    // alone is $4,000–12,000 at 300–1,000 lb/day, which is why the old $2,400 was sold at a loss.
    { name: "Ice machine replacement — modular head + bin, installed (up to 500lb/day)", categoryName: "Refrigeration", unitPriceCents: 700000, costCents: 430000 },

    // ── Boilers & Hydronics ─────────────────────────────────────────────────
    { name: "Boiler repair — diagnose & repair", categoryName: "Boilers & Hydronics", unitPriceCents: 45000, costCents: 20000 },
    { name: "Circulator pump replacement", categoryName: "Boilers & Hydronics", unitPriceCents: 65000, costCents: 30000 },
    { name: "Boiler system flush", categoryName: "Boilers & Hydronics", unitPriceCents: 37500, costCents: 15000 },
    // Must stay ABOVE the $250 commercial trip fee — the shop cannot pay to attend its own
    // inspections. $300 is mid of the $200–500 tune-up/inspection band.
    { name: "Boiler inspection", categoryName: "Boilers & Hydronics", unitPriceCents: 30000, costCents: 14000 },
    // $18,000 is the FLOOR for a small commercial boiler installed in 2026 (under 300K BTU/hr;
    // 300K–1M BTU is $18,000–34,000). A condensing upgrade adds $6,000–10,000 for venting and
    // controls and is NOT in this number. Do not lower this without changing the name to a
    // residential-size unit — the old $13,500 contradicted its own citation.
    { name: "Commercial boiler replacement (under 300K BTU, like-for-like)", categoryName: "Boilers & Hydronics", unitPriceCents: 1800000, costCents: 1080000 },

    // ── Rooftop Units ───────────────────────────────────────────────────────
    { name: "RTU repair — diagnose & repair", categoryName: "Rooftop Units", unitPriceCents: 80000, costCents: 35000 },
    { name: "RTU economizer actuator replacement", categoryName: "Rooftop Units", unitPriceCents: 50000, costCents: 22000 },
    { name: "RTU belt replacement", categoryName: "Rooftop Units", unitPriceCents: 25000, costCents: 13000 },
    { name: "RTU condenser coil cleaning", categoryName: "Rooftop Units", unitPriceCents: 35000, costCents: 15000 },
    { name: "RTU compressor replacement (3–5 ton)", categoryName: "Rooftop Units", unitPriceCents: 520000, costCents: 320000 },
    // SPLIT BY TONNAGE ON PURPOSE. Installed RTU pricing is roughly $2,800–3,500 per ton at this
    // size, so one flat 3-to-5-ton line underbid every 5-ton job by ~$4,000. Both prices EXCLUDE
    // the crane — that is the separate line below, and it is mandatory on a rooftop swap.
    { name: "RTU replacement (packaged, 3 ton) — excludes crane", categoryName: "Rooftop Units", unitPriceCents: 950000, costCents: 570000 },
    { name: "RTU replacement (packaged, 5 ton) — excludes crane", categoryName: "Rooftop Units", unitPriceCents: 1350000, costCents: 810000 },
    // Subcontracted pass-through, so the margin is thinner than wrench work by design (~30%).
    // A one-to-two-storey lift runs the shop $1,200–1,800; taller or tight-access sites more.
    { name: "Crane / rigging — rooftop lift (per unit set)", categoryName: "Rooftop Units", unitPriceCents: 200000, costCents: 140000 },

    // ── Preventive Maintenance ──────────────────────────────────────────────
    // These three are PER PIECE OF EQUIPMENT and the schema has no equipment-count unit (see the
    // header). The names say so in words; the office must enter the quantity by hand. Do not
    // shorten them back to "(per unit)" — that reads as a whole-building price on the quote.
    { name: "Refrigeration PM — per visit, quarterly plan (one walk-in)", categoryName: "Preventive Maintenance", unitPriceCents: 20000, costCents: 13000 },
    { name: "Commercial boiler maintenance — per boiler, per year", categoryName: "Preventive Maintenance", unitPriceCents: 75000, costCents: 30000 },
    // Cost covers TWO truck rolls a year (2 × the $110 trip floor) plus filters, belts and time.
    { name: "RTU preventive maintenance — per rooftop unit, per year", categoryName: "Preventive Maintenance", unitPriceCents: 65000, costCents: 32000 },
    // Descaling a commercial machine is a $200–300 job, not a $150 one, and it is a 1.5-hour
    // visit with chemical — it cannot cost the shop $50.
    { name: "Ice machine cleaning / PM service", categoryName: "Preventive Maintenance", unitPriceCents: 22500, costCents: 12000 },

    // ── Service & Diagnostic ────────────────────────────────────────────────
    // THE COST FLOOR ANCHOR. 11000 is one loaded tech hour including drive; no line above may
    // be costed below it.
    { name: "Diagnostic / trip fee (commercial)", categoryName: "Service & Diagnostic", unitPriceCents: 25000, costCents: 11000 },
    { name: "Emergency after-hours call", categoryName: "Service & Diagnostic", unitPriceCents: 45000, costCents: 21000 },
    // Commercial refrigeration, NOT the residential R-410A line in hvac.ts. EPA 608 leak-rate
    // repair and reporting obligations kick in above a 50 lb charge — a system that size is a
    // custom quote, not this line.
    { name: "Refrigerant leak detection & repair (commercial refrigeration, R-448A)", categoryName: "Service & Diagnostic", unitPriceCents: 100000, costCents: 45000 },
    // Charge size is what moves this number: commercial systems hold 10–60 lb, so anything past
    // 10 lb should be re-quoted rather than sold at this price.
    { name: "Refrigerant recovery & recharge (per system, up to 10lb)", categoryName: "Service & Diagnostic", unitPriceCents: 75000, costCents: 33000 },
  ],
  // Commercial-scope unless the comment says otherwise. The Aug 2026 audit dropped six URLs that
  // either 403'd to every fetch or covered residential appliances while being cited for
  // commercial lines. The two oxmaint pages bot-block automated fetches but are correct-scope and
  // their figures were re-confirmed against samcofm (boilers) and salmonhvac (RTUs).
  sources: [
    // Refrigeration — walk-in, reach-in, components
    "https://1800coolaid.com/cost-to-repair-a-walk-in-cooler/",
    "https://samedayappliance.repair/price-list/walk-in-cooler-repair-cost/",
    "https://coolriteems.com/pricing/",
    "https://www.homeyou.com/ca/commercial-refrigeration-repair-los-angeles-costs",
    // Ice machines — repair labor, then equipment + installed pricing
    "https://samedayappliance.repair/price-list/commercial-ice-machine-repair-cost/",
    "https://quench.culligan.com/blog/how-much-does-a-commercial-ice-machine-cost/",
    "https://icemachineprices.com/ice-machine-prices",
    "https://www.katom.com/learning-center/ice-maker-cost-2026-pricing-guide.html",
    // Boilers
    "https://oxmaint.com/industries/hvac/boiler-replacement-cost-2026-commercial-pricing-btu-fuel-efficiency",
    "https://www.samcofm.com/commercial-boiler-replacement-cost-michigan/",
    "https://www.fixr.com/costs/repair-boiler", // residential scope — corroborates repair/inspection/circulator only
    // Rooftop units
    "https://oxmaint.com/industries/hvac/rtu-replacement-cost-2026-per-ton-pricing-install-labor-hidden-costs",
    "https://salmonhvac.com/blog/commercial-rtu-repair-vs-replacement-utah/",
    "https://wranglerac.com/blog/commercial-rtu-replacement-san-antonio-guide",
    "https://northbreezehvac.com/blog/carrier-rtu-common-problems/",
    // Preventive maintenance
    "https://northbreezehvac.com/services/commercial-refrigeration/maintenance-plans/",
    "https://www.servicetitan.com/blog/commercial-refrigeration-maintenance-contracts",
    "https://buffos-refrigeration.com/how-much-to-budget-for-refrigeration-maintenance/",
    "https://www.haroldbros.com/blog/commercial-hvac-preventative-maintenance-cost",
  ],
};
