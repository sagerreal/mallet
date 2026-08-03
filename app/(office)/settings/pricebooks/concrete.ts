import type { SeedServiceInput } from "@mallet/pricebook";
import type { TradePricebook } from "./types";

/**
 * Starter pricebook for a residential CONCRETE / flatwork shop.
 *
 * UNITS — read this before touching a `measuredBy`.
 *
 *   `site_sqft` is the traced surface's AREA. Flatwork (driveways, patios, walkways, slabs) is
 *   priced per square foot, so area lines carry it.
 *
 *   `site_lnft` is NOT a generic linear foot. build-from-measurements.ts maps it to
 *   `site.perimeterLnft` — the PERIMETER of the traced surface — and service-row.tsx labels it
 *   "Site perimeter (per ln ft)". Only a line that genuinely runs around the edge of the traced
 *   slab may carry it. Curbing does. Crack length, footing run and step width do NOT: a crack is
 *   wherever the crack is, a footing follows the foundation, and a stoop's width has nothing to
 *   do with a driveway's perimeter. Those lines are hand-entered lengths — they keep "(per
 *   linear ft)" in the NAME and leave `measuredBy` undefined, because pricing them against the
 *   perimeter silently bills a 20x30 driveway for 100 ft of work nobody scoped.
 *
 * WHICH LINE AUTO-SEEDS. The tracer picks exactly ONE service per measured kind — lowest
 * position wins (`lowestPositionByKind`), and seed-pricebook.ts assigns position from ARRAY
 * INDEX. So the first `site_sqft` line and the first `site_lnft` line in this file are what a
 * shop gets quoted before it touches anything. Those are, deliberately:
 *   site_sqft → "Concrete driveway — broom finish (per sqft)"   (the pack's bread and butter)
 *   site_lnft → "Concrete landscape curbing (per linear ft)"     (the only true perimeter line)
 * index.test.ts pins the site_sqft choice. Moving either is a conscious edit.
 *
 * SOURCING. Most figures are the midpoint of a national 2025/2026 range; a few are deliberately
 * set elsewhere in that range and say so in a comment. Do not assume "midpoint" — each line
 * below carries the range it came from, so a re-check takes a minute instead of an afternoon.
 * Ten of the URLs in `sources` sit behind a Cloudflare bot wall and 403 to curl/WebFetch alike,
 * so each is annotated with the figure it was read for; the number survives the page.
 *
 * `costCents` is this shop's own estimated cost (materials + labor burden) on the same per-unit
 * basis — not independently sourced, set at a trade-typical margin (concrete/rebar/forming is
 * material-heavy, so cost runs a higher fraction of price than a labor-only sealing line).
 *
 * Money: integer cents, same convention as pricebook-seed.ts.
 */

const CONCRETE_CATEGORIES = [
  "Flatwork — Broom Finish",
  "Flatwork — Stamped",
  "Flatwork — Exposed Aggregate",
  "Site Prep & Reinforcement",
  "Repair & Leveling",
  "Sealing & Resurfacing",
  "Curbs, Footings & Steps",
  "Service & Minimums",
] as const;

const CONCRETE_SERVICES: readonly SeedServiceInput[] = [
  // ── Flatwork — Broom Finish ───────────────────────────────────────────────────
  // FIRST site_sqft line in the file = the one the tracer auto-seeds. Pinned by index.test.ts.
  {
    name: "Concrete driveway — broom finish (per sqft)",
    categoryName: "Flatwork — Broom Finish",
    unitPriceCents: 900, // broom finish $8–$12/sqft (yardandgardenguru, Jun 2026); low-mid
    costCents: 520,
    measuredBy: "site_sqft",
  },
  {
    name: "Concrete patio — broom finish (per sqft)",
    categoryName: "Flatwork — Broom Finish",
    unitPriceCents: 950, // inside $8–$12/sqft; patio carries more edge/form per sqft than a drive
    costCents: 550,
    measuredBy: "site_sqft",
  },
  {
    name: "Concrete sidewalk / walkway — broom finish (per sqft)",
    categoryName: "Flatwork — Broom Finish",
    unitPriceCents: 1000, // inside $8–$12/sqft; narrow pours are the least efficient flatwork
    costCents: 580,
    measuredBy: "site_sqft",
  },

  // ── Flatwork — Stamped ────────────────────────────────────────────────────────
  {
    name: "Stamped concrete — driveway/patio (per sqft)",
    categoryName: "Flatwork — Stamped",
    unitPriceCents: 1400, // concretenetwork: basic $10–$14, mid $14–$20. This is basic/mid boundary,
    costCents: 850, //        deliberately NOT a midpoint — a shop selling mid-range should raise it.
    measuredBy: "site_sqft",
  },

  // ── Flatwork — Exposed Aggregate ──────────────────────────────────────────────
  {
    name: "Exposed aggregate concrete (per sqft)",
    categoryName: "Flatwork — Exposed Aggregate",
    unitPriceCents: 1100, // midpoint of $8–$14/sqft (yardandgardenguru, Jun 2026)
    costCents: 650,
    measuredBy: "site_sqft",
  },

  // ── Site Prep & Reinforcement ─────────────────────────────────────────────────
  // The two biggest sources of quote variance on flatwork, and both used to be invisible: the
  // pour lines above quote the same $9.00/sqft whether the slab is 4in over good soil or 5in
  // over clay with #4 rebar on 18in centers. Add them per sqft ALONGSIDE the pour line, not
  // instead of it — they are the same traced area.
  {
    name: "Site prep — excavation, grading & gravel base (per sqft)",
    categoryName: "Site Prep & Reinforcement",
    unitPriceCents: 175, // 2026 guides: $1.00–$2.50/sqft, 10–25% of job cost; midpoint $1.75
    costCents: 100,
    measuredBy: "site_sqft",
  },
  {
    name: "Rebar / wire mesh reinforcement (per sqft)",
    categoryName: "Site Prep & Reinforcement",
    unitPriceCents: 80, // wire mesh ~$0.30–$0.60/sqft installed, #4 rebar ~$0.60–$1.20; $0.80 mid
    costCents: 45,
    measuredBy: "site_sqft",
  },

  // ── Repair & Leveling ─────────────────────────────────────────────────────────
  // Crack work is HAND-MEASURED length — no `measuredBy`. Crack footage is not the traced
  // slab's perimeter, and billing it as such would charge a full lap of the driveway.
  {
    name: "Crack repair — rout, fill & finish (per linear ft)",
    categoryName: "Repair & Leveling",
    unitPriceCents: 1650, // midpoint of homewyse $14.97–$17.90/lnft (Jan 2026); full residential
    costCents: 700, //        scope: rout, fill, site prep, cleanup. Best-sourced line in the pack.
  },
  {
    name: "Hairline crack seal — clean & caulk (per linear ft)",
    categoryName: "Repair & Leveling",
    unitPriceCents: 250, // DISTINCT SCOPE from the line above: clean-and-caulk only, no routing,
    costCents: 110, //       no finish pass. 2026: unrouted seal $0.90–$1.50/lnft, routed
    //                       $1.50–$3.00. Set at the routed midpoint because residential minimums
    //                       push small jobs to $2–$5/lnft. Below ~30 lnft use the minimum charge.
  },
  {
    name: "Structural crack repair — epoxy injection (per crack)",
    categoryName: "Repair & Leveling",
    unitPriceCents: 65000, // per DEFECT, not per foot. 2026: $400–$1,500/crack (common band) and
    costCents: 27000, //       $300–$900 elsewhere; $650 is the conservative cross-band midpoint.
    //                         $300–$500 is the MINOR case — this line is the structural one.
  },
  {
    name: "Slab leveling / mudjacking (per sqft)",
    categoryName: "Repair & Leveling",
    unitPriceCents: 650, // midpoint of $4–$9/sqft (homeguide mudjacking, 2026)
    costCents: 280,
    measuredBy: "site_sqft",
  },
  {
    name: "Concrete slab replacement (per sqft)",
    categoryName: "Repair & Leveling",
    unitPriceCents: 1300, // MUST equal this pack's own pour + demo: $9.00 + $4.00. Anything less
    costCents: 780, //        and a shop selling "replacement" loses to itself selling two lines.
    //                        Also mid-band on the external $6–$14/sqft slab-replacement range.
    measuredBy: "site_sqft",
  },
  {
    name: "Concrete removal / demolition — unreinforced (per sqft)",
    categoryName: "Repair & Leveling",
    unitPriceCents: 400, // inside removal $2–$8/sqft incl. disposal (angi/homeguide, 2026)
    costCents: 220,
    measuredBy: "site_sqft",
  },
  {
    name: "Concrete removal — reinforced (rebar/mesh, per sqft)",
    categoryName: "Repair & Leveling",
    unitPriceCents: 600, // reinforced adds $1–$3/sqft over plain (cutting + disposing steel);
    costCents: 350, //       $2.00 premium = mid of that delta. Reinforced is the COMMON case.
    measuredBy: "site_sqft",
  },

  // ── Sealing & Resurfacing ─────────────────────────────────────────────────────
  {
    name: "Concrete sealing (per sqft)",
    categoryName: "Sealing & Resurfacing",
    unitPriceCents: 193, // inside $1–$3/sqft (angi concrete sealing, 2026), above the ~$1.50 avg
    costCents: 70,
    measuredBy: "site_sqft",
  },
  {
    name: "Concrete resurfacing / overlay (per sqft)",
    categoryName: "Sealing & Resurfacing",
    unitPriceCents: 500, // midpoint of $3–$7/sqft basic overlay (homeguide resurfacing, 2026)
    costCents: 250,
    measuredBy: "site_sqft",
  },

  // ── Curbs, Footings & Steps ───────────────────────────────────────────────────
  // FIRST site_lnft line in the file = the one the tracer auto-seeds against the traced
  // PERIMETER. Curbing is the only line in this pack that genuinely runs the slab's edge.
  {
    name: "Concrete landscape curbing (per linear ft)",
    categoryName: "Curbs, Footings & Steps",
    unitPriceCents: 1600, // RESIDENTIAL extruded landscape curbing: $5–$18/lnft installed 2026,
    costCents: 900, //        basic slant/mower $12–$15, stamped/textured $15–$18. Do NOT
    //                        re-benchmark against homewyse's "concrete curb" page ($47–$58/lnft)
    //                        — that is cast-in-place municipal curb, a different product.
    measuredBy: "site_lnft",
  },
  {
    name: "Concrete footing (per linear ft)",
    categoryName: "Curbs, Footings & Steps",
    unitPriceCents: 875, // standard residential 16in W x 8in D strip footing: $8.78/lnft, typical
    costCents: 490, //       band $7–$9 (Inch Calculator 2026). A 12x6 footing is ~$4–$5/lnft — if
    //                       that is what you sell, say so in the name. Hand-entered run length,
    //                       NOT the traced perimeter, so no `measuredBy`.
  },
  {
    name: "Concrete steps — poured (per step)",
    categoryName: "Curbs, Footings & Steps",
    unitPriceCents: 32500, // PER STEP (per riser), because risers are the cost driver — this line
    costCents: 17500, //      used to be priced per linear ft of step WIDTH, which quoted a 3-step
    //                        and a 6-step stoop identically. 2026: $200–$500 per poured step,
    //                        $1,000–$5,000 for 5–10 steps; $325 is the midpoint. Steps are
    //                        COUNTED, never traced, so no `measuredBy`.
  },

  // ── Service & Minimums ────────────────────────────────────────────────────────
  {
    name: "Minimum job charge / mobilization",
    categoryName: "Service & Minimums",
    unitPriceCents: 40000, // Flat, per job. Every per-unit line above can quote below the trade's
    costCents: 22000, //      own floor on a small ticket — 40 sqft of mudjacking is $260, a 20 ft
    //                        caulk run is $50 — but a truck, a crew and a load-out cost the same
    //                        either way. 2026 contractor minimums run $300–$700; $400 is
    //                        conservative. Cost = crew half-day + truck, not materials.
  },
];

export const CONCRETE_PRICEBOOK: TradePricebook = {
  key: "concrete",
  categories: CONCRETE_CATEGORIES,
  services: CONCRETE_SERVICES,
  // Annotated with the figure each was read for (Aug 2026). Ten of these 403 behind Cloudflare
  // to every non-browser client, so the annotation is the durable part — re-check by opening
  // them in a browser, or prefer the four that serve cleanly (marked OK).
  sources: [
    // OK — broom finish $8–$12/sqft, exposed aggregate $8–$14/sqft. Dated Jun 19 2026.
    "https://yardandgardenguru.com/how-much-concrete-driveway/",
    // OK to curl (403s to WebFetch) — slab $6–$12/sqft installed, driveway $8–$20. May 2026.
    "https://concreteblockcalculator.com/knowledge-base/cost-of-concrete-slab/",
    // OK — stamped basic $10–$14/sqft, mid-range $14–$20, high-end $20+.
    "https://www.concretenetwork.com/stamped-concrete/cost.html",
    // OK — crack repair $14.97–$17.90/lnft, scope = rout/fill cracks to 1/4in. Jan 2026.
    "https://www.homewyse.com/maintenance_costs/cost_to_repair_cracked_concrete.html",
    // OK — footings: 16x8 strip = $8.78/lnft, typical band $7–$9; 12x6 = $4–$5. 2026.
    "https://www.inchcalculator.com/concrete-footings-cost/",
    // 403 (live) — concrete sealing $1–$3/sqft, avg ~$1.50.
    "https://www.angi.com/articles/how-much-does-concrete-sealing-cost.htm",
    // 403 (live) — mudjacking $4–$9/sqft; notes contractor job minimums of $300–$700.
    "https://homeguide.com/costs/mudjacking-cost",
    // 403 (live) — concrete demo $2–$8/sqft incl. disposal; reinforced adds $1–$3/sqft.
    "https://www.angi.com/articles/how-much-should-concrete-demo-cost-square-foot.htm",
    // 403 (live) — concrete removal $3–$8/sqft.
    "https://homeguide.com/costs/concrete-removal-cost",
    // 403 (live) — resurfacing/overlay $3–$7/sqft basic.
    "https://homeguide.com/costs/concrete-resurfacing-cost",
    // 403 (live) — footing $5–$18/lnft (wide; the Inch Calculator band above is tighter).
    "https://www.angi.com/articles/concrete-footing-cost.htm",
    // 403 (live) — poured steps $200–$500 PER STEP, $1,000–$5,000 for 5–10 steps.
    "https://homeguide.com/costs/concrete-steps-cost",
    // 403 (live) — RESIDENTIAL landscape curbing $5–$18/lnft installed.
    "https://homeguide.com/costs/landscape-curbing-cost",
    // 403 (live) — landscape curbing, corroborates the $5–$18/lnft band.
    "https://www.angi.com/articles/how-much-does-it-cost-install-landscape-curbing.htm",
    // 403 (live) — foundation/structural crack repair; epoxy & polyurethane injection per crack.
    "https://homeguide.com/costs/foundation-crack-repair-cost",
  ],
};
