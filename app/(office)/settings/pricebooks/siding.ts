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
 * WHAT `site_sqft` IS: the traced SITE AREA off the aerial takeoff (service-row.tsx labels it
 * "Site area (per sq ft)") — i.e. the whole wall surface, not a patch. Only lines that scale
 * with the whole elevation may carry it. A repair line is scoped to the damaged area, never to
 * the traced area, so repairs stay FLAT with the scope written into the name.
 *
 * TEAR-OFF IS NOT INCLUDED in the four installation lines. They price install over sound
 * substrate; on a re-side add "Siding tear-off & disposal — existing" alongside.
 *
 * `costCents` is the shop's own cost (materials + labor burden), same per-unit basis as the
 * price, not the customer price. Every figure below is the midpoint of a national 2025/2026
 * market-rate range — see `sources`.
 *
 * COST FLOOR: this pack sells no trip fee, so every flat line's cost is floored at a loaded
 * field hour (~$70-$75/hr incl. drive and burden) times the real wrench time, plus parts. The
 * margin readout is what a shop prices its next job against — a $40 "cost" on a site visit
 * shows 80% on the highest-volume ticket in the book and is a false belief, not a rounding.
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
    "Prep & Tear-off",
    "Inspections & Weatherproofing",
  ],

  services: [
    // ── Repairs (flat, per job — scoped by NAME, never by traced site area) ────
    {
      // ~2 loaded hrs + panel/starter stock. Angi/HomeGuide scope a vinyl section at $200-$600.
      name: "Siding repair — vinyl panel patch/replace",
      categoryName: "Repairs",
      unitPriceCents: 40000,
      costCents: 18000,
    },
    {
      // ~3 loaded hrs + cedar/board stock, prime & paint the cut ends.
      name: "Siding repair — wood section replacement",
      categoryName: "Repairs",
      unitPriceCents: 60000,
      costCents: 27000,
    },
    {
      // ~4 loaded hrs — fiber cement is a two-person cut with dust control — plus plank stock.
      name: "Siding repair — fiber cement section replacement",
      categoryName: "Repairs",
      unitPriceCents: 80000,
      costCents: 36000,
    },
    {
      // BOUNDED FLAT, deliberately. HomeGuide prices repair work at $2-$14/sq ft; this line is
      // that midpoint (~$8/sq ft) taken out to 400 sq ft. Past 400 sq ft, or once sheathing has
      // to come off, re-scope it — do NOT attach it to `site_sqft`, which is the whole traced
      // elevation and would bill a two-panel wind-lift call against the entire house.
      name: "Siding repair — storm/moisture damage, multi-section (up to 400 sq ft)",
      categoryName: "Repairs",
      unitPriceCents: 325000,
      costCents: 146250,
    },

    // ── Vinyl Siding — priced PER SQ FT (site_sqft), see header ─────────────────
    // FIRST site_sqft line in the file = what the tracer auto-seeds onto a quote. This is the
    // volume seller and must stay first; do not move cedar or tear-off above it.
    {
      // $8.50/sq ft: inside Homewyse ($7.32-$12.51), Fixr ($3-$12) and Landmark's standard
      // grade ($7.50-$10.00). Excludes tear-off — see the Prep & Tear-off line.
      name: "Vinyl siding installation — standard",
      categoryName: "Vinyl Siding",
      unitPriceCents: 850,
      costCents: 470,
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
      // $11.70/sq ft = This Old House / HomeGuide's stated national average for cedar
      // ($6-$14 installed). Shake and premium clear grades run to $16 — raise this line, and
      // say "shake" in the name, if that is what the shop actually sells.
      name: "Cedar wood siding installation",
      categoryName: "Wood & Engineered Wood Siding",
      unitPriceCents: 1170,
      costCents: 645,
      measuredBy: "site_sqft",
    },
    {
      name: "Engineered wood siding installation (LP SmartSide-type)",
      categoryName: "Wood & Engineered Wood Siding",
      unitPriceCents: 675,
      costCents: 370,
      measuredBy: "site_sqft",
    },

    // ── Prep & Tear-off ────────────────────────────────────────────────────────
    {
      // Per sq ft of the SAME traced area as the install line it accompanies. Every re-side
      // needs this; new construction does not. $1.00/sq ft brackets Dropcurb's vinyl
      // ($0.25-$1.00) and wood ($0.50-$1.50) removal-and-haul rates. ASBESTOS-CEMENT SIDING IS
      // NOT THIS LINE — abatement runs $7-$10/sq ft and is a licensed scope.
      name: "Siding tear-off & disposal — existing",
      categoryName: "Prep & Tear-off",
      unitPriceCents: 100,
      costCents: 55,
      measuredBy: "site_sqft",
    },

    // ── Inspections & Weatherproofing — mixed: linear-foot runs measured, visit flat ─
    {
      // Flat visit. Cost = 1-1.5 loaded hours incl. drive time, not the $40 of "gas and a
      // ladder" — this is the pack's highest-volume ticket and its margin sets the shop's
      // sense of what a visit is worth.
      name: "Siding inspection / storm damage assessment",
      categoryName: "Inspections & Weatherproofing",
      unitPriceCents: 20000,
      costCents: 9000,
    },
    {
      // $0.78/sq ft = midpoint of Homewyse's $0.70-$0.86 national INSTALLED range. That range
      // is what the homeowner pays; the shop's own cost is wrap material (~$0.10-$0.15/sq ft)
      // plus about 200 sq ft of hanging per loaded hour. Do not copy the installed figure into
      // costCents again.
      name: "House wrap / weather barrier installation",
      categoryName: "Inspections & Weatherproofing",
      unitPriceCents: 78,
      costCents: 43,
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
      // $17.00/ln ft = the blended national average across materials (HomeGuide and This Old
      // House both give $6-$30/ln ft, average $17) — the same basis as the fascia line above
      // it, which is why the two now sit within a few dollars of each other. A vinyl-only shop
      // should drop this to about 1020 (Angi's vinyl soffit average, $6.50-$14).
      name: "Soffit replacement",
      categoryName: "Inspections & Weatherproofing",
      unitPriceCents: 1700,
      costCents: 935,
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

  // Checked 2026-08-02. Entries marked [403] are LIVE pages that Cloudflare blocks to scripts
  // and agents — open them in a browser; do not delete them as dead links. Entries marked [ok]
  // were fetched and read in full on that date.
  sources: [
    // Repairs
    "https://homeguide.com/costs/siding-repair-cost", // [403] $2-$14/sq ft repair; vinyl $200-$600/section
    "https://www.angi.com/articles/how-much-cost-repair-siding.htm", // [403] vinyl $200-$600, fiber cement $400-$1,200
    // Vinyl — national basis for the $8.50 standard line
    "https://www.homewyse.com/services/cost_to_install_vinyl_siding.html", // [ok] $7.32-$12.51/sq ft installed, May 2026
    "https://www.fixr.com/costs/vinyl-siding", // [ok] $3-$12/sq ft; standard residential grade $4-$7 + $2-$5 labor
    "https://www.landmarkroof.com/news/vinyl-siding-cost-per-square-foot", // [ok] REGIONAL (Puget Sound) corroboration only — standard $7.50-$10.00
    // Fiber cement
    "https://homeguide.com/costs/fiber-cement-siding-cost", // [403] $6-$15/sq ft installed
    "https://www.angi.com/articles/cost-of-hardie-board-siding.htm", // [403] $7-$18/sq ft, average $12.50
    // Wood & engineered wood
    "https://www.thisoldhouse.com/siding/cedar-siding-cost", // [ok] cedar ~$11.70/sq ft average; shake $7-$16
    "https://homeguide.com/costs/wood-siding-cost-to-install-or-replace", // [403] cedar $6-$14/sq ft, average $11.70
    "https://sidingcosts.com/lp-smart-siding-cost/", // [ok] LP SmartSide $4.50-$9.00/sq ft installed 2026
    // Tear-off
    "https://dropcurb.com/blog/siding-removal-cost", // [ok] removal+disposal: vinyl $0.25-$1.00/sq ft, wood $0.50-$1.50
    // Weatherproofing & trim runs
    "https://www.homewyse.com/services/cost_to_install_house_wrap.html", // [ok] $0.70-$0.86/sq ft INSTALLED (homeowner price, not shop cost)
    "https://www.thisoldhouse.com/roofing/soffit-replacement-cost", // [ok] soffit $6-$30/ln ft, average $17
    "https://homeguide.com/costs/soffit-and-fascia-replacement-cost", // [403] soffit average $17/ln ft; labor $2-$7 + material $1-$7
    "https://www.angi.com/articles/fascia-cost.htm", // [403] fascia $7-$22/ln ft, average $14.60
    "https://www.homewyse.com/services/cost_to_caulk_perimeter_of_home.html", // [ok] $2.45-$5.03/ln ft, May 2026
    "https://www.angi.com/articles/cost-to-caulk.htm", // [403] $1.25-$4.00/ln ft incl. supplies
  ],
};
