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
 * ORDER MATTERS. The tracer auto-seeds the FIRST line of each measured kind (see
 * lowestPositionByKind in modules/quoting/app/build-from-measurements.ts; SeedPricebookUseCase
 * passes each service's array index as its position). So the first `site_lnft` line in this file
 * is what a traced perimeter quotes before anyone touches it — it MUST be the seamless aluminum
 * install, the job most gutter shops actually run. Copper used to win that slot by alphabetical
 * tie-break and auto-quoted a 180 ft house at $9,000. Do not move it.
 *
 * `costCents` is the shop's own cost (materials + labor burden), same per-unit basis as the
 * price, not the customer price. COST FLOOR: this pack sells no trip fee, so every short-visit
 * and repair line is costed at no less than one loaded at-height field hour (~$60/hr: wage +
 * payroll tax + the high workers' comp rate ladder work carries) plus parts and wrench time.
 * Costing a truck roll at materials only would render a fake 75% margin on the shop's
 * highest-volume ticket and it would price the next job down on the strength of it.
 *
 * Prices are national 2025/2026 market-rate figures. Most are the midpoint of a cited range;
 * where a range's floor was chosen deliberately (the cheapest guard type, for instance) the line
 * says so. Each figure carries the source it came from inline, because the pack-level `sources`
 * list contradicts itself on copper and steel and a bare list invites the wrong pick.
 *
 * Money: integer cents, matching CreateServiceCommand/DTO.
 */
export const GUTTERS_PRICEBOOK: TradePricebook = {
  key: "gutters",

  categories: [
    "Seamless Aluminum Gutters",
    "Copper & Steel Gutters",
    "Gutter Guards",
    "Downspouts & Drainage",
    "Tear-off & Disposal",
    "Repairs & Maintenance",
  ],

  services: [
    // ── Seamless Aluminum Gutters — priced PER LINEAR FOOT (site_lnft) ─────────
    // FIRST site_lnft line in the file ON PURPOSE: this is what the tracer auto-quotes.
    {
      // 5"/6" K-style. $8.00 per LINEAR FOOT — thisoldhouse.com/gutters/seamless-gutters-cost
      // and homeguide.com/costs/seamless-gutters-cost both give aluminum $4-$9/lf installed.
      name: "Seamless aluminum gutter installation",
      categoryName: "Seamless Aluminum Gutters",
      unitPriceCents: 800,
      costCents: 400,
      measuredBy: "site_lnft",
    },
    {
      // An UPLIFT ON TOP OF the base rate, not a standalone rate: $2.00/lf on an $8.00/lf base
      // is the ~25% two-story premium gutterfx.com/blog/gutter-repair-cost-guide describes
      // (20-30% for two-story access). It was seeded at $10.00/lf — larger than the base line it
      // uplifts — which quoted two-story aluminum at $18.00/lf, roughly double the market.
      // Almost pure labor/equipment, hence the thinner margin.
      name: "Seamless aluminum gutter installation — 2-story+ height surcharge (add to base rate)",
      categoryName: "Seamless Aluminum Gutters",
      unitPriceCents: 200,
      costCents: 110,
      measuredBy: "site_lnft",
    },

    // ── Copper & Steel Gutters — priced PER LINEAR FOOT (site_lnft) ─────────────
    {
      // $34.00 per LINEAR FOOT. The cited copper sources disagree hard — thisoldhouse
      // $15-$25/lf, angi.com/articles/copper-gutters-guide.htm $18-$40/lf, homeguide
      // $30-$50/lf, modernize.com/gutters/types/copper $25.30-$73.80/lf (avg $49.55).
      // $34 is the blended midpoint and sits inside three of the four; the seeded $50.00/lf sat
      // at or above every ceiling but modernize's and left only a 35% margin.
      name: "Copper gutter installation",
      categoryName: "Copper & Steel Gutters",
      unitPriceCents: 3400,
      costCents: 1800,
      measuredBy: "site_lnft",
    },
    {
      // $11.30 per LINEAR FOOT. thisoldhouse.com/gutters/seamless-gutters-cost gives galvanized
      // $8-$10/lf; angi's galvanized page implies ~$6.70-$12.50/lf from whole-home totals over a
      // typical 150-200 lf run. (modernize's $22.85/lf average is a national outlier — not used.)
      name: "Galvanized steel gutter installation",
      categoryName: "Copper & Steel Gutters",
      unitPriceCents: 1130,
      costCents: 570,
      measuredBy: "site_lnft",
    },

    // ── Gutter Guards — priced PER LINEAR FOOT (site_lnft) ──────────────────────
    {
      // $6.00 per LINEAR FOOT — deliberately the FLOOR of the $6-$13/lf installed band that
      // homeadvisor.com/cost/gutters/gutter-guards/ and angi both give, because screen is the
      // cheapest guard type. It was seeded at $2.50/lf, a DIY material price that quoted a 200 ft
      // guard job at $500 against a $1,200-$2,600 market.
      name: "Gutter guard — screen-style",
      categoryName: "Gutter Guards",
      unitPriceCents: 600,
      costCents: 300,
      measuredBy: "site_lnft",
    },
    {
      // $12.00 per LINEAR FOOT — top of the same $6-$13/lf installed band, which is where
      // micro-mesh belongs.
      name: "Gutter guard — micro-mesh (premium)",
      categoryName: "Gutter Guards",
      unitPriceCents: 1200,
      costCents: 540,
      measuredBy: "site_lnft",
    },

    // ── Downspouts & Drainage — new runs measured, fixtures/extensions flat ─────
    {
      // $8.00 per LINEAR FOOT OF DOWNSPOUT (the vertical drop, NOT the eave run — a 2-story drop
      // is ~24 ft). homeguide.com/costs/downspouts-cost: 3x4 aluminum ~$8/lf installed, whole
      // range $6.50-$22.25/lf; thisoldhouse.com/gutters/gutter-repair-cost independently gives
      // $8/lf. Seeded at $3.00/lf it was under half the cheapest published figure.
      name: "Downspout installation (new)",
      categoryName: "Downspouts & Drainage",
      unitPriceCents: 800,
      costCents: 380,
      measuredBy: "site_lnft",
    },
    {
      // FLAT per downspout, not per foot: swapping one existing downspout is a whole-item job
      // priced as such. gutterfx.com/blog/gutter-repair-cost-guide: complete downspout
      // replacement $150-$400; $275 is the midpoint.
      name: "Downspout replacement (existing), each",
      categoryName: "Downspouts & Drainage",
      unitPriceCents: 27500,
      costCents: 14000,
    },
    {
      // FLAT each. home.costhelper.com/downspout-extension.html: $10-$50 material with
      // installation $30-$100; $65 is the middle of the INSTALLED band. Seeded at $30 it was
      // exactly the material ceiling — a truck roll for one extension lost money.
      // Cost assumes it is added to a visit already on site (~15 min wrench time + material).
      name: "Downspout extension — above-ground, each",
      categoryName: "Downspouts & Drainage",
      unitPriceCents: 6500,
      costCents: 3200,
    },
    {
      // FLAT per downspout, not per foot of trench: the $150-$350 angi range for underground
      // drainage is quoted per downspout and already includes a 10' run, trenching, catch basin
      // and bubbler. Cost is ~2 loaded hours plus pipe/basin — the seeded $113 was under one.
      name: "Underground downspout drainage extension, per downspout",
      categoryName: "Downspouts & Drainage",
      unitPriceCents: 25000,
      costCents: 14000,
    },

    // ── Tear-off & Disposal — line-itemed on essentially every replacement quote ─
    {
      // $1.50 per LINEAR FOOT of existing gutter stripped and hauled. Its own line rather than
      // buried in the install rate, because it is length-driven and gets waived on new
      // construction. Cost carries the dump fee as well as the labor.
      name: "Gutter removal & haul-away (existing)",
      categoryName: "Tear-off & Disposal",
      unitPriceCents: 150,
      costCents: 70,
      measuredBy: "site_lnft",
    },

    // ── Repairs & Maintenance — mostly flat, two linear-foot repair-scale lines ──
    {
      // FLAT per visit. gutterfx: seam separation $100-$200/seam, sealant fix $75-$150;
      // thisoldhouse.com/gutters/gutter-repair-cost: aluminum gutter repair $85-$200, avg $143.
      // $165 is the blended midpoint with room for the truck roll. Seeded at $225 it cleared both
      // ceilings while the pack header claimed every figure was a midpoint.
      name: "Gutter seam repair / reseal",
      categoryName: "Repairs & Maintenance",
      unitPriceCents: 16500,
      costCents: 8000,
    },
    {
      // FLAT per visit. gutterfx: sagging section $250-$500. Cost is ~2.5 loaded at-height hours
      // plus hangers/fasteners; seeded at $98 it reported a fictional 70% margin.
      name: "Gutter resecure / re-hang — sagging section",
      categoryName: "Repairs & Maintenance",
      unitPriceCents: 32500,
      costCents: 15000,
    },
    {
      // FLAT per visit. gutterfx: pitch correction $150-$400.
      name: "Gutter reslope / re-pitch adjustment",
      categoryName: "Repairs & Maintenance",
      unitPriceCents: 17000,
      costCents: 8500,
    },
    {
      // $11.50 per LINEAR FOOT of the section replaced — NOT the whole perimeter. Never the
      // auto-seeded perimeter rate (that is the aluminum install line at the top of this file).
      // thisoldhouse.com/gutters/gutter-repair-cost: K-style section repair $8-$15/lf, avg $12.
      // Costs MORE per foot than a full new run: setup, tie-ins and matching on a short piece.
      name: "Gutter section replacement (repair-scale)",
      categoryName: "Repairs & Maintenance",
      unitPriceCents: 1150,
      costCents: 600,
      measuredBy: "site_lnft",
    },
    {
      // $1.50 per LINEAR FOOT of guarded gutter. The standard cleaning up-charge on a guarded
      // home — the crew has to pull the guards to clean and reset them afterwards.
      name: "Gutter guard removal & reinstall for cleaning",
      categoryName: "Repairs & Maintenance",
      unitPriceCents: 150,
      costCents: 70,
      measuredBy: "site_lnft",
    },
    {
      // FLAT per appointment. homeguide.com/costs/gutter-cleaning-cost: one-story $70-$200
      // (midpoint $135). Cost is ~1.2 loaded hours including ladder setup, downspout flush and
      // debris haul-off; the seeded $34 was well under a single hour.
      name: "Gutter cleaning — single-story home",
      categoryName: "Repairs & Maintenance",
      unitPriceCents: 13500,
      costCents: 7000,
    },
    {
      // FLAT per appointment. homeguide: two-story $100-$275 (midpoint $188). Costs more than the
      // single-story clean for the reason it prices higher — fall protection and slower staging.
      name: "Gutter cleaning — two-story home",
      categoryName: "Repairs & Maintenance",
      unitPriceCents: 19000,
      costCents: 11000,
    },
  ],

  sources: [
    "https://www.thisoldhouse.com/gutters/gutter-repair-cost",
    // Post-redirect URL; /resources/blog/... 301s here.
    "https://www.gutterfx.com/blog/gutter-repair-cost-guide",
    "https://www.thisoldhouse.com/gutters/gutter-cleaning-cost",
    // The HomeGuide and Angi pages below 403 automated fetchers but are live with 2026 data.
    "https://homeguide.com/costs/gutter-cleaning-cost",
    "https://homeguide.com/costs/seamless-gutters-cost",
    "https://www.thisoldhouse.com/gutters/seamless-gutters-cost",
    "https://modernize.com/gutters/types/copper",
    "https://homeguide.com/costs/copper-gutters-cost",
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
