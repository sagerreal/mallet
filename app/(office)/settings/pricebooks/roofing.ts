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
 * WHAT A MEASURED LINE GETS MULTIPLIED BY — read before adding or re-uniting one. The tracer
 * feeds `site_sqft` the WHOLE traced roof area (trace.areaSqft) and `site_lnft` the WHOLE traced
 * perimeter (trace.perimeterLnft) — see app/(office)/composer/held-trace-seed.ts. So a product
 * that only covers PART of the roof (an eave course, a ridge run, a valley) must not be priced
 * against site_sqft, or the app bills a narrow band across the entire deck. Only a re-roof is
 * really the whole area, and only drip edge is really the whole perimeter.
 *
 * ORDER MATTERS. The tracer auto-quotes the FIRST line of each measured kind in this array
 * (lowestPositionByKind, modules/quoting/app/build-from-measurements.ts). The deliberate
 * defaults are "Tear-off & replace — architectural/dimensional shingle" for site_sqft (the
 * common re-roof) and "Drip edge installation — existing roof" for site_lnft (the one line whose
 * quantity really is the perimeter). Every other measured line sits below them on purpose and
 * expects a human-entered quantity — do not reorder without updating index.test.ts.
 *
 * `costCents` is the shop's own cost (materials + labor burden), same per-unit basis as the
 * price, not the customer price. Short-visit lines — repairs, inspections, single add-ons —
 * carry a loaded crew hour plus drive time, NOT materials alone: the pricebook UI renders a live
 * margin off this field, and a materials-only cost shows a shop 75% on its highest-volume ticket
 * and teaches it to price the next one too low.
 *
 * Every figure below sits inside a national 2025/2026 market-rate range, usually at the
 * midpoint; where a line is deliberately off the midpoint it says so inline. See `sources` — and
 * the figure recorded inline next to each line, because several publishers (HomeGuide, Angi)
 * return 403 to an automated fetch and a URL nobody can open is not evidence.
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
    // Cost on a repair is a two-person crew for ~1.5-2 hours plus drive time and the truck,
    // then parts — not the bundle of shingles alone. Roofing's own trade data puts labor at
    // ~90% of a small repair ticket (myheritageroofing, cited below: ~$360 of a $400 job).
    {
      name: "Roof leak repair — minor (few shingles)",
      categoryName: "Repairs",
      unitPriceCents: 35000, // $150-$400 typical minor repair, 2026
      costCents: 17500,
    },
    {
      name: "Flashing repair — chimney or valley",
      categoryName: "Repairs",
      unitPriceCents: 37500, // flashing repair $200-$600, common $300-$450
      costCents: 18500,
    },
    {
      name: "Shingle repair — small area patch",
      categoryName: "Repairs",
      unitPriceCents: 40000, // $150-$400 patch range, top end for a full patch
      costCents: 20000,
    },
    {
      name: "Roof leak repair — moderate (flashing + shingles)",
      categoryName: "Repairs",
      unitPriceCents: 75000, // leak repair runs $400-$1,900 once it is more than a patch
      costCents: 37500,
    },
    {
      // Flat per job on purpose: the tarped area is the damaged section, never the traced roof,
      // so this must NOT carry site_sqft. $150-$1,500 overall, most emergencies $300-$750
      // (skylightroofing 2026); after-hours runs ~1.5x. Cost is a 2-tech storm call plus the
      // tarp, battens and fasteners.
      name: "Emergency roof tarping — storm response",
      categoryName: "Repairs",
      unitPriceCents: 55000,
      costCents: 28000,
    },

    // ── Shingle Roofing — priced PER SQ FT (site_sqft), see header ─────────────
    {
      // FIRST site_sqft line = the one the tracer auto-quotes. Keep it the common re-roof.
      name: "Tear-off & replace — architectural/dimensional shingle",
      categoryName: "Shingle Roofing",
      unitPriceCents: 600, // $5.00-$7.00/sq ft installed, midpoint
      costCents: 330,
      measuredBy: "site_sqft",
    },
    {
      name: "Tear-off & replace — 3-tab shingle (economy)",
      categoryName: "Shingle Roofing",
      unitPriceCents: 450, // $4.50-$7.50/sq ft; economy end on purpose
      costCents: 250,
      measuredBy: "site_sqft",
    },
    {
      name: "Roof recover — shingle overlay (no tear-off)",
      categoryName: "Shingle Roofing",
      unitPriceCents: 475, // ~20-25% under the tear-off line (mrroof)
      costCents: 260,
      measuredBy: "site_sqft",
    },
    {
      // Per 4x8 SHEET, not per sq ft, and deliberately unmeasured: rot is only found once the
      // shingles are off and is counted in sheets, so no traced quantity predicts it. This is
      // the most common change-order on a re-roof — seeded so the shop and the front desk have
      // a number ready. $80-$100/sheet OSB, $100-$135 plywood installed (roof-installation.com
      // 2026); cost is the sheet plus the ~20 minutes it takes with the deck already exposed.
      name: "Roof decking replacement — 4x8 sheet, each",
      categoryName: "Shingle Roofing",
      unitPriceCents: 9500,
      costCents: 5000,
    },

    // ── Metal Roofing — priced PER SQ FT (site_sqft) ────────────────────────────
    {
      name: "Standing seam metal roof — steel/aluminum",
      categoryName: "Metal Roofing",
      unitPriceCents: 1350, // steel $10-$16, aluminum $11-$18 installed (HomeAdvisor), midpoint
      costCents: 740,
      measuredBy: "site_sqft",
    },
    {
      name: "Standing seam metal roof — copper (premium)",
      categoryName: "Metal Roofing",
      unitPriceCents: 3000, // $25-$35/sq ft installed (HomeAdvisor), midpoint
      costCents: 1650,
      measuredBy: "site_sqft",
    },
    {
      // Deliberately NOT the midpoint of its range: $7-$12/sq ft installed (Western States),
      // seeded at the economy end because exposed-fastener panel is what a shop sells against
      // shingle on price. Move toward $9.50 for heavier gauge or a steep/complex roof.
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
      unitPriceCents: 900, // $6.50-$11.50/sq ft installed, midpoint
      costCents: 450,
      measuredBy: "site_sqft",
    },
    {
      name: "EPDM rubber membrane roof installation",
      categoryName: "Flat & Low-Slope Roofing",
      unitPriceCents: 800, // $4-$10/sq ft installed; high half of the common range
      costCents: 400,
      measuredBy: "site_sqft",
    },

    // ── Inspections & Diagnostics (flat, per job) ──────────────────────────────
    // An inspection is almost pure labor: an hour or more on a roof, plus drive time and the
    // truck. Cost reflects that, not the price of a ladder.
    {
      name: "Roof inspection — visual",
      categoryName: "Inspections & Diagnostics",
      unitPriceCents: 25000, // avg $251, range $125-$383 (HomeAdvisor)
      costCents: 11000,
    },
    {
      name: "Roof inspection — drone/aerial",
      categoryName: "Inspections & Diagnostics",
      unitPriceCents: 27500, // drone inspection $150-$400 (HomeAdvisor)
      costCents: 12500,
    },

    // ── Ventilation & Add-ons — mixed: linear-foot runs measured, unit items flat ─
    {
      // FIRST site_lnft line = the one the tracer auto-quotes, and the only add-on whose
      // quantity really IS the traced perimeter. $5-$9/ln ft on an existing roof (HomeGuide
      // 2026), midpoint. Do not move a partial-run line above this one.
      name: "Drip edge installation — existing roof",
      categoryName: "Ventilation & Add-ons",
      unitPriceCents: 700,
      costCents: 400,
      measuredBy: "site_lnft",
    },
    {
      // Per ln ft of RIDGE — roughly a quarter of the perimeter on a simple gable — so the
      // estimator types the ridge length in. It sits BELOW drip edge deliberately: only the
      // first site_lnft line auto-seeds, and perimeter is the wrong quantity for this one.
      // Rate: $240-$600 installed, ~$450 on a standard gable (~40 ln ft of ridge) ≈ $11/ln ft
      // (Fixr 2026); HomeGuide gives $7-$15/ln ft, midpoint $11.
      name: "Ridge vent installation (per ln ft of ridge)",
      categoryName: "Ventilation & Add-ons",
      unitPriceCents: 1100,
      costCents: 600,
      measuredBy: "site_lnft",
    },
    {
      // Per ln ft of EAVE + VALLEY run, NOT roof area — was site_sqft, which billed a
      // narrow-band membrane across the whole deck. The shield only covers the first 3-6 ft up
      // from the edge plus valleys and penetrations (realcostiq). At the cited $4-$5.50/sq ft
      // installed a 36" course is ~$14/ln ft; double it for a 6 ft cold-climate course. Sits
      // below drip edge so it never auto-seeds off perimeter.
      name: "Ice & water shield upgrade — eaves & valleys",
      categoryName: "Ventilation & Add-ons",
      unitPriceCents: 1400,
      costCents: 800,
      measuredBy: "site_lnft",
    },
    {
      // Each. Turbine $65-$250, box $55-$200 installed (Fixr 2026). Cost assumes the crew is
      // already on the roof for other work — a dedicated trip for one vent does not clear it.
      name: "Roof vent installation — turbine or box, each",
      categoryName: "Ventilation & Add-ons",
      unitPriceCents: 15000,
      costCents: 8000,
    },
    {
      // Each. $250-$600, national avg ~$400 — and the same source puts labor at ~90% of the
      // ticket (~$360 of $400) against $10-$50 of materials, so cost here is a short crew visit
      // with drive time, not the boot.
      name: "Pipe boot / vent flashing replacement, each",
      categoryName: "Ventilation & Add-ons",
      unitPriceCents: 40000,
      costCents: 20000,
    },
    {
      name: "Skylight replacement (existing opening)",
      categoryName: "Ventilation & Add-ons",
      unitPriceCents: 160000, // $800-$2,400 in an existing opening, 2026
      costCents: 88000,
    },
  ],

  // Re-checkable citations. Three previously-cited URLs were REMOVED rather than kept: the
  // ThisOldHouse standing-seam page (material-only figures that contradict the installed prices
  // above), the listwithclever inspection page (states a $1,239 average — ~5x every other
  // source, including its own co-citation), and the roofgnome vent page (hard 404). The
  // HomeGuide / Angi / roofrivercity pages 403 an automated fetch but are live in a browser;
  // their figures are recorded inline above so a blocked URL cannot erase the evidence.
  sources: [
    "https://www.billraganroofing.com/blog/how-much-architectural-asphalt-shingle-roof-cost",
    "https://odonnellroofingco.com/blog/asphalt-shingle-roof-cost/",
    "https://www.mrroof.com/blog/roof-overlay-vs-tear-off-the-truth-about-costs-2025-guide/",
    "https://roof-installation.com/roof-decking-replacement-cost/",
    "https://www.homeadvisor.com/cost/roofing/standing-seam-metal-roof",
    "https://www.westernstatesmetalroofing.com/metal-roof-cost",
    "https://www.schoenherrroofing.com/blog/2025-tpo-roofing-cost-value-pros-cons/",
    "https://www.angi.com/articles/epdm-roofing-cost.htm",
    "https://www.angi.com/articles/cost-to-repair-asphalt-shingles.htm",
    "https://roofrivercity.com/roof-leak-repair-cost/",
    "https://skylightroofing.com/how-much-does-emergency-roof-tarping-cost/",
    "https://www.homeadvisor.com/cost/inspectors-and-appraisers/hire-a-roof-inspector/",
    "https://www.fixr.com/costs/roof-vent-installation",
    "https://homeguide.com/costs/cost-to-install-roof-vent",
    "https://myheritageroofing.com/boot-camp-for-your-roof-a-vent-replacement-guide/",
    "https://homeguide.com/costs/skylight-installation-cost",
    "https://realcostiq.com/roof-underlayment-calculator/",
    "https://homeguide.com/costs/drip-edge-cost",
  ],
};
