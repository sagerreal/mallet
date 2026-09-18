/**
 * app/(office)/settings/pricebooks/electrical.ts
 * Starter pricebook for a residential + light-commercial electrical shop. Pure data, no logic —
 * composed into the generic SeedPricebookUseCase by whichever router procedure seeds it, same
 * pattern as app/(office)/settings/pricebook-seed.ts (the plumbing pack).
 *
 * Electrical is a SERVICE trade: every line is a flat per-job price (no `measuredBy`).
 *
 * METHOD — read this before editing a number:
 *  - Every `unitPriceCents` sits INSIDE the range of at least one source below. Where the sources
 *    disagree (they often do: a national cost index vs. one contractor's price page), the figure
 *    is in the overlap, biased to the upper half because a service shop carries overhead a
 *    homeowner-facing "average" does not. It is NOT a strict midpoint — an earlier revision
 *    claimed that and five lines sat above their own cited ceiling.
 *  - `costCents` is the SHOP's cost, not the customer price, and it is floored at a loaded
 *    service visit (~$65 — the same figure the diagnostic line carries: drive time + the first
 *    wrench-on hour, burdened) PLUS parts. A repair line costed at parts only reports a fake 70%
 *    margin in the app's live margin readout, and a shop prices the next job down on the strength
 *    of it. Per-unit adders (recessed can, smoke detector) are the one exception: they ride an
 *    existing visit, so they carry parts + their own wrench time, not a second trip.
 *  - Prices are STARTING POINTS the shop edits. Costs are guesses at a generic shop's cost base.
 *
 * SOURCES — homeguide.com and angi.com (over half the list) return HTTP 403 to curl, WebFetch and
 * any non-browser client. They are NOT dead links; open them in a real browser before assuming so.
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
    // $280 = top of the national implied range (breaker $20-$100 + $130-$180 labor). AFCI/GFCI
    // work usually means matching an odd panel's breaker stock, so it sits at the top, not the mid.
    { name: "Replace AFCI/GFCI breaker", categoryName: "Panels & Service", unitPriceCents: 28000, costCents: 13000 },
    // $550 is the only figure inside BOTH cited ranges (HomeGuide $200-$600, Dr Watts $450-$700).
    // Cost = ~$150 breaker + a 1.5hr loaded visit; a utility disconnect, if needed, is extra.
    { name: "Replace main breaker", categoryName: "Panels & Service", unitPriceCents: 55000, costCents: 26000 },

    // ── Wiring & Outlets ────────────────────────────────────────────────────
    { name: "Install new outlet (existing circuit)", categoryName: "Wiring & Outlets", unitPriceCents: 25000, costCents: 10000 },
    { name: "Replace outlet", categoryName: "Wiring & Outlets", unitPriceCents: 14000, costCents: 7000 },
    // Switch/dimmer swap: Housecall Pro's 2026 electrician pricing puts it at $85-$200.
    { name: "Replace switch or install dimmer", categoryName: "Wiring & Outlets", unitPriceCents: 14000, costCents: 7000 },
    { name: "Install GFCI outlet (replace existing)", categoryName: "Wiring & Outlets", unitPriceCents: 15000, costCents: 8000 },
    { name: "Install GFCI outlet (new circuit)", categoryName: "Wiring & Outlets", unitPriceCents: 27500, costCents: 12500 },
    // Dedicated 240V run (dryer, range, hot tub, well pump, window AC). Housecall Pro: $570-$1,000.
    // Distinct from the EV charger line, which is a dedicated circuit PLUS the EVSE and its permit.
    { name: "Install dedicated 240V circuit (dryer/range/hot tub)", categoryName: "Wiring & Outlets", unitPriceCents: 78000, costCents: 39000 },
    // FLAT, but the trade prices this per sq ft ($5-$17/sq ft nationally). The size assumption is
    // in the name on purpose: at ~$8.30/sq ft this is a 1,800 sq ft home. Scale it by floor area —
    // quoting a 1,200 sq ft bungalow and a 3,000 sq ft two-story the same number is wrong by ~2x.
    { name: "Whole-house rewire — approx. 1,800 sq ft home", categoryName: "Wiring & Outlets", unitPriceCents: 1500000, costCents: 900000 },

    // ── Lighting & Fixtures ─────────────────────────────────────────────────
    { name: "Install light fixture (existing wiring)", categoryName: "Lighting & Fixtures", unitPriceCents: 25000, costCents: 10000 },
    { name: "Install ceiling fan (existing wiring)", categoryName: "Lighting & Fixtures", unitPriceCents: 20000, costCents: 8000 },
    { name: "Install ceiling fan (new switch wiring)", categoryName: "Lighting & Fixtures", unitPriceCents: 45000, costCents: 19000 },
    // PER FIXTURE, not per job — a 6-can kitchen is 6 of this line. Priced for RETROFIT into an
    // existing ceiling ($200-$400/light), not new construction ($125-$250), which a service shop
    // rarely sells. Cost carries the can + trim + its own wrench time, no second trip charge.
    { name: "Install recessed light (per fixture)", categoryName: "Lighting & Fixtures", unitPriceCents: 27500, costCents: 12000 },

    // ── EV & Generator ──────────────────────────────────────────────────────
    { name: "Install Level 2 EV charger", categoryName: "EV & Generator", unitPriceCents: 170000, costCents: 95000 },
    // Top of the cited $6,000-$11,000 installed range. A 22kW+ unit on a long gas/conduit run
    // reaches $12,000-$15,000 in 2026 — raise it per job rather than seeding above the source.
    { name: "Install whole-house standby generator", categoryName: "EV & Generator", unitPriceCents: 1000000, costCents: 600000 },
    // $1,050: inside HomeGuide's $400-$1,300 installed range for a MANUAL switch (~$450 of it is
    // the switch itself). An automatic transfer switch is a different, dearer line — add it if sold.
    { name: "Install manual transfer switch (up to 10-circuit)", categoryName: "EV & Generator", unitPriceCents: 105000, costCents: 52000 },

    // ── Diagnostics & Repair ────────────────────────────────────────────────
    // This line's cost ($65) is the pack's loaded-visit floor: drive time + first hour, burdened.
    { name: "Electrical troubleshooting / diagnostic", categoryName: "Diagnostics & Repair", unitPriceCents: 15000, costCents: 6500 },
    { name: "Emergency after-hours call", categoryName: "Diagnostics & Repair", unitPriceCents: 27500, costCents: 13000 },
    // Same one-hour visit as the diagnostic above, so it costs the shop the same.
    { name: "Repair dead outlet or switch", categoryName: "Diagnostics & Repair", unitPriceCents: 15000, costCents: 6500 },

    // ── Safety & Inspection ─────────────────────────────────────────────────
    // $175 against a cited "$100-$200, most homeowners around $150" — a 1.5-2hr walkthrough plus
    // a written report, so the cost is a visit and a half, not the $60 an earlier revision carried.
    { name: "Electrical safety inspection", categoryName: "Safety & Inspection", unitPriceCents: 17500, costCents: 8500 },
    { name: "Install whole-house surge protector", categoryName: "Safety & Inspection", unitPriceCents: 32500, costCents: 16000 },
    // PER DETECTOR on a multi-detector visit. Cost = ~$45 hardwired device + ~30 min of loaded
    // labor; the device ALONE is $40-$100, so anything under that is arithmetically impossible.
    { name: "Install hardwired smoke detector (per unit)", categoryName: "Safety & Inspection", unitPriceCents: 11500, costCents: 7000 },
  ],
  sources: [
    // NOTE: homeguide.com and angi.com 403 every automated client. Open them in a browser.
    "https://homeguide.com/costs/cost-to-replace-electrical-panel",
    "https://www.thisoldhouse.com/electrical/cost-to-upgrade-electrical-panel",
    "https://vonselectric.com/articles/200-amp-panel-upgrade-cost/",
    "https://homeguide.com/costs/cost-to-install-a-subpanel",
    "https://homeguide.com/costs/cost-to-replace-a-circuit-breaker-switch",
    "https://drwattselectric.com/circuit-breaker-replacement-cost/",
    "https://homeguide.com/costs/electrician-cost-per-hour",
    "https://www.housecallpro.com/resources/how-to-price-electrical-work/",
    "https://www.homeadvisor.com/cost/electrical/gfci-outlet-cost",
    "https://homeguide.com/costs/cost-to-rewire-a-house",
    "https://www.angi.com/articles/how-much-does-it-cost-rewire-house.htm",
    "https://homeguide.com/costs/lighting-fixture-installation-cost",
    "https://www.homeadvisor.com/cost/heating-and-cooling/install-a-ceiling-fan/",
    "https://www.cansandfans.com/blog/recessed-lighting-installation-cost-in-2026/",
    "https://www.homewyse.com/services/cost_to_install_recessed_lighting.html",
    "https://qmerit.com/blog/understanding-your-ev-home-charging-station-costs-for-installation/",
    "https://www.angi.com/articles/how-much-does-it-cost-install-generator.htm",
    "https://homeguide.com/costs/generator-cost",
    "https://homeguide.com/costs/generator-transfer-switch-installation-cost",
    "https://homeguide.com/costs/electrical-inspection-cost",
    "https://homeguide.com/costs/whole-house-surge-protector-cost",
    "https://homeguide.com/costs/smoke-detector-installation-cost",
    "https://www.angi.com/articles/smoke-detector-installation-cost.htm",
  ],
};
