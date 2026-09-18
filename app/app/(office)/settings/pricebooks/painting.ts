import type { SeedServiceInput } from "@mallet/pricebook";
import type { TradePricebook } from "./types";

/**
 * Starter pricebook for a residential PAINTING shop — the trade the interior room-measurement
 * feature (walls_sqft / ceiling_sqft / baseboard_lnft / crown_lnft / doors_count / windows_count)
 * was actually built for. Most lines here carry a `measuredBy` and unitPriceCents is the rate
 * PER ONE of that unit (per sqft, per linear ft, per door/window) — never a flat job price,
 * because a flat "Interior painting — $X" is wrong for every room that isn't exactly average.
 *
 * THE UNIT TRAP, read before touching any per-sqft figure. `walls_sqft` is GROSS WALL SURFACE
 * (derive-painting.ts sums the wall polygons and never deducts openings). The "$2–$6 per square
 * foot" headline that Angi and HomeAdvisor lead with is per square foot of FLOOR / home area —
 * their own tables say so (1,000 sqft home = $2,000–$6,000). A 2,000 sqft home carries roughly
 * 5,500 sqft of wall, so importing that midpoint onto walls_sqft over-quotes by ~2.8x. Every
 * per-sqft figure in this file is per square foot of the surface being painted, and the sources
 * chosen for those lines (Homewyse) quote on that same surface basis.
 *
 * Cabinet painting has no measured-quantity kind (the room-measurement tool doesn't take cabinet
 * linear footage), so those lines are seeded as flat tiers (small/medium/large kitchen) off a
 * per-linear-ft market rate applied to typical kitchen footages — flagged in `sources`.
 *
 * COST FLOOR. `costCents` is this shop's own estimated cost (materials + loaded labor) on the
 * same per-unit basis. This pack sells no trip fee, so the floor for anything that consumes a
 * visit is ONE LOADED PAINTER HOUR ≈ $32 (BLS-derived 2026 painter median ~$24/hr × ~1.35
 * burden), plus parts and wrench time. A repair line costed at materials only reports a 70%
 * margin on the shop's highest-volume ticket and teaches it to price the next job too low —
 * the same species of dishonesty the "never seeds a zero cost" test guards against, and harder
 * to spot because the number looks deliberate. Margins land in the 45–57% band across the pack;
 * cabinets and the hourly line sit lower on purpose, because they are almost pure labor.
 *
 * Money: integer cents, same convention as pricebook-seed.ts.
 */

/** One loaded painter hour, in cents. The cost floor for any line that consumes a visit. */
const LOADED_HOUR_CENTS = 3200;

const PAINTING_CATEGORIES = [
  "Interior Walls & Ceilings",
  "Trim, Doors & Windows",
  "Exterior",
  "Cabinets",
  "Prep & Repair",
  "Service Minimums",
] as const;

const PAINTING_SERVICES: readonly SeedServiceInput[] = [
  // ── Interior Walls & Ceilings ────────────────────────────────────────────────
  {
    // FIRST walls_sqft line — the measurement tracer auto-seeds it onto a quote. Keep it first.
    // Per sq ft of GROSS WALL SURFACE, not floor area. Homewyse "Cost to Paint Wall" (May 2026):
    // $1.29–$2.78/sqft of wall, midpoint $2.04, excluding contractor overhead (add 13–22%) —
    // $2.25 is that midpoint carried to retail. Do NOT re-import Angi/HomeAdvisor's "$2–$6 per
    // sqft": that is per FLOOR sqft and lands ~2.8x high here (see the header).
    name: "Interior wall painting (2 coats)",
    categoryName: "Interior Walls & Ceilings",
    unitPriceCents: 225,
    costCents: 105,
    measuredBy: "walls_sqft",
  },
  {
    // Per sq ft of ceiling. Homewyse ceiling $1.37–$2.95 (midpoint $2.16); HomeGuide 2026
    // $1–$2 smooth. Ceilings price at or slightly above walls per sqft — that is normal, not a
    // typo: the cutting-in and overhead roller work is slower than open wall.
    name: "Ceiling painting",
    categoryName: "Interior Walls & Ceilings",
    unitPriceCents: 200,
    costCents: 95,
    measuredBy: "ceiling_sqft",
  },
  {
    // Priced ABOVE open wall on purpose. A soffit is two planes meeting at an outside corner with a
    // cut-in along both edges, worked overhead off a ladder — the sqft goes slowly. Painters quote
    // these by the foot in the field; per sqft keeps it on the same measured footing as everything
    // else here, and the painter enters the area because the scanner cannot see a soffit at all.
    name: "Soffit / bulkhead painting",
    categoryName: "Interior Walls & Ceilings",
    unitPriceCents: 315,
    costCents: 145,
    measuredBy: "soffit_sqft",
  },
  {
    // Per sq ft of wall surface. HomeGuide 2026: $0.80–$3.00/sqft, midpoint $1.90.
    name: "Wallpaper removal",
    categoryName: "Interior Walls & Ceilings",
    unitPriceCents: 190,
    costCents: 85,
    measuredBy: "walls_sqft",
  },
  {
    // Per sq ft of ceiling. Homewyse (May 2026): $1.28–$2.26/sqft, midpoint $1.77.
    name: "Popcorn ceiling removal",
    categoryName: "Interior Walls & Ceilings",
    unitPriceCents: 177,
    costCents: 80,
    measuredBy: "ceiling_sqft",
  },

  // ── Trim, Doors & Windows ─────────────────────────────────────────────────────
  {
    // Per linear ft of run. HomeGuide/Angi 2026 interior trim: $1–$4/lnft, midpoint $2.50.
    name: "Baseboard / trim painting",
    categoryName: "Trim, Doors & Windows",
    unitPriceCents: 250,
    costCents: 110,
    measuredBy: "baseboard_lnft",
  },
  {
    // Per linear ft to PAINT crown — not to install it (crown INSTALL is $4–$15/lnft, and the
    // old $7.00 here was an install rate). Homewyse "Cost to Paint Crown Molding" (May 2026):
    // $2.10–$4.45/lnft, midpoint $3.28. Runs ~1.3x the baseboard line, which is the real spread.
    name: "Crown molding painting",
    categoryName: "Trim, Doors & Windows",
    unitPriceCents: 330,
    costCents: 150,
    measuredBy: "crown_lnft",
  },
  {
    // Per DOOR (slab both sides + frame + casing), not per sqft. Sources disagree: HomeGuide
    // 2026 interior door $75–$150 (midpoint $112.50); Homewyse "Cost to Paint a Door" (May 2026)
    // $163–$332, which assumes hardware removal and reinstall. $123 follows HomeGuide plus a
    // little of Homewyse's prep.
    name: "Interior door & frame painting",
    categoryName: "Trim, Doors & Windows",
    unitPriceCents: 12300,
    costCents: 5500,
    measuredBy: "doors_count",
  },
  {
    // Per WINDOW, converted from a linear-foot source: Homewyse window trim (May 2026)
    // $2.59–$5.40/lnft × the ~18–22 lnft of casing+sill on a typical 3x5 window = $47–$119.
    name: "Interior window trim & frame painting",
    categoryName: "Trim, Doors & Windows",
    unitPriceCents: 8750,
    costCents: 3800,
    measuredBy: "windows_count",
  },

  // ── Exterior ──────────────────────────────────────────────────────────────────
  {
    // FIRST site_sqft line — the takeoff tracer auto-seeds it. Keep it first.
    // Per sq ft of painted SURFACE (siding/stucco face), which is what the takeoff's surface
    // area is — confirm it is not being read as building footprint before quoting. HomeGuide
    // 2026 exterior repaint $1.50–$5.00/sqft (typical $2.50–$3.50); Homewyse $2.20–$4.37.
    name: "Exterior house painting",
    categoryName: "Exterior",
    unitPriceCents: 300,
    costCents: 150,
    measuredBy: "site_sqft",
  },
  {
    // Per sq ft washed. HomeAdvisor 2026: $0.10–$0.50/sqft; $0.16 is a pre-paint prep rate,
    // deliberately near the floor because it is sold attached to a repaint, not standalone.
    name: "Exterior power washing (pre-paint prep)",
    categoryName: "Exterior",
    unitPriceCents: 16,
    costCents: 6,
    measuredBy: "site_sqft",
  },
  {
    // Per linear ft of eave/rake run. site_lnft is the takeoff's building PERIMETER, which is
    // the right proxy for fascia and soffit runs — it is NOT the wall area, so this line must
    // never be repriced as if it were per sqft. Homewyse exterior trim (May 2026): $2.55–$5.21
    // per lnft, midpoint $3.88.
    name: "Exterior trim / fascia / soffit painting",
    categoryName: "Exterior",
    unitPriceCents: 388,
    costCents: 185,
    measuredBy: "site_lnft",
  },
  {
    // Flat, per door. Deliberately NOT measuredBy doors_count — that count comes from an
    // interior room scan and would bill every bedroom door at the front-door rate. Homewyse
    // "Cost to Paint a Door" (May 2026) $163–$332; an exterior/front door sits at the top of
    // that because of weather prep and the finish coat.
    name: "Exterior / front door painting (each)",
    categoryName: "Exterior",
    unitPriceCents: 22500,
    costCents: 10500,
  },

  // ── Cabinets (no measured-quantity kind exists for cabinet linear footage — seeded as flat
  //     tiers at a constant $50 per linear ft, the rate two independent sources agree on:
  //     HomeGuide 2026 $30–$70/lnft, and Homewyse $5.40–$10.79 per sqft of cabinet face, which
  //     works out to ~$50/lnft once contractor overhead is added. The footages below are the
  //     market's own worked examples — 20 lnft is a SMALL-to-average kitchen, not a large one.
  //     Angi's dollar bands run higher for cabinet-count-heavy kitchens (large $2,800–$5,000+);
  //     a 40+ lnft kitchen should be quoted off the rate, not off the top tier. These are
  //     PAINTING prices — true refinishing (strip and restain) is roughly 2–3x and is not
  //     seeded here, which is why the lines are no longer named "refinishing". ────────────────
  {
    name: "Cabinet painting — small kitchen (~20 linear ft)",
    categoryName: "Cabinets",
    unitPriceCents: 100000,
    costCents: 55000,
  },
  {
    name: "Cabinet painting — medium kitchen (~30 linear ft)",
    categoryName: "Cabinets",
    unitPriceCents: 150000,
    costCents: 82500,
  },
  {
    name: "Cabinet painting — large kitchen (~40 linear ft)",
    categoryName: "Cabinets",
    unitPriceCents: 200000,
    costCents: 110000,
  },

  // ── Prep & Repair ─────────────────────────────────────────────────────────────
  {
    // Flat, per patch. The three cited drywall sources disagree by ~3x: Angi $20–$120 for a hole
    // up to 4in (but "most repair pros charge $100–$160 for small work"), Homewyse $297–$472 per
    // patch, HomeGuide $300–$500. $225 is between Angi's top and Homewyse's floor and reflects
    // the real shape of the job — mud has to dry, so it is two visits, not one.
    name: "Drywall patch — small hole (up to 4in)",
    categoryName: "Prep & Repair",
    // 2 visits x ~1.5 loaded hours + compound/tape/texture/touch-up paint.
    unitPriceCents: 22500,
    costCents: LOADED_HOUR_CENTS * 3 + 1400,
  },
  {
    // Flat. HomeGuide 2026: "$500 to $800+ to fix a larger area"; Homewyse is in the same place.
    name: "Drywall patch — large area / multiple holes",
    categoryName: "Prep & Repair",
    // ~8 loaded hours across two visits + board, compound and texture materials.
    unitPriceCents: 60000,
    costCents: LOADED_HOUR_CENTS * 8 + 2400,
  },
  {
    // Flat, per pop. An ADD-ON priced per item — set, patch, sand, spot-prime is ~20 minutes
    // once the painter is already on site. It does not carry a visit and must never be
    // dispatched alone; "Minimum job charge" below is what makes a small call payable.
    name: "Nail pop repair (each)",
    categoryName: "Prep & Repair",
    unitPriceCents: 3500,
    costCents: 1500,
  },
  {
    // Per billed hour. HomeGuide 2026 "Cost to Hire a Painter": $25–$75/hr, typical $40–$60;
    // HomeAdvisor: $20–$50/hr. $50 is the middle of the typical band. Cost is one loaded hour —
    // labor-only time cannot show a materials-only cost, or every margin rollup that includes
    // hours is fiction.
    name: "Touch-up & minor repair painting",
    categoryName: "Prep & Repair",
    unitPriceCents: 5000,
    costCents: LOADED_HOUR_CENTS,
    measuredBy: "hour",
  },

  // ── Service Minimums ──────────────────────────────────────────────────────────
  {
    // Flat, genuinely per-job — no measuredBy. This pack sells no trip fee, so without this line
    // a shop can quote a $35 nail pop and lose money the moment the truck rolls. HomeGuide 2026:
    // "Some painters charge a $250 to $500 minimum fee." Cost = the drive plus ~4 hours on site.
    name: "Minimum job charge",
    categoryName: "Service Minimums",
    unitPriceCents: 35000,
    costCents: LOADED_HOUR_CENTS * 5,
  },
];

/**
 * WHAT A PAINTER BUYS, in the unit the supplier sells it in.
 *
 * These are COSTS, never prices. Markup bands turn a cost into a sell price, and a starter pack
 * that hard-coded a margin would be inventing this shop's pricing for it.
 *
 * COVERAGE IS THE POINT, and it is why a painter gets a stock list where a plumber does not. A
 * plumber buys a water heater for one address; a painter consumes the same dozen items on every
 * job, and the quantity is not a guess — it falls out of the wall area. One gallon covers about
 * 350 sq ft of primed drywall per coat, so a scanned 210 sq ft bathroom at two coats is 1.2
 * gallons, which is two cans because paint is not sold by the fifth. That number lives in each
 * description so it is on the shelf label rather than in someone's head.
 *
 * Figures are 2026 US contractor-grade retail (Sherwin-Williams / Behr Pro / PPG trade lines),
 * which is what a 1-3 crew shop actually pays — not builder-grade, not designer.
 */
const PAINTING_MATERIALS = [
  {
    name: "Interior latex, eggshell",
    unitOfMeasure: "gal",
    unitCostCents: 3800,
    description: "Walls. Covers ~350 sq ft per coat.",
    categoryName: "Interior Walls & Ceilings",
  },
  {
    name: "Interior latex, flat",
    unitOfMeasure: "gal",
    unitCostCents: 3000,
    description: "Ceilings. Covers ~350 sq ft per coat.",
    categoryName: "Interior Walls & Ceilings",
  },
  {
    name: "Interior latex, semi-gloss",
    unitOfMeasure: "gal",
    unitCostCents: 4200,
    description: "Trim, doors, cabinets. Covers ~350 sq ft per coat.",
    categoryName: "Trim, Doors & Windows",
  },
  {
    name: "Drywall primer (PVA)",
    unitOfMeasure: "gal",
    unitCostCents: 2200,
    description: "New or patched drywall. Covers ~300 sq ft.",
    categoryName: "Prep & Repair",
  },
  {
    name: "Stain-blocking primer",
    unitOfMeasure: "gal",
    unitCostCents: 3800,
    description: "Water stains, smoke, dark-to-light colour changes. Covers ~300 sq ft.",
    categoryName: "Prep & Repair",
  },
  {
    name: "Exterior acrylic, satin",
    unitOfMeasure: "gal",
    unitCostCents: 5200,
    description: "Exterior body and trim. Covers ~300 sq ft per coat on smooth siding.",
    categoryName: "Exterior",
  },
  {
    name: "Painter's caulk",
    unitOfMeasure: "tube",
    unitCostCents: 350,
    description: "Trim-to-wall seams. One tube runs ~40 ln ft.",
    categoryName: "Prep & Repair",
  },
  {
    name: "Spackle / patching compound",
    unitOfMeasure: "qt",
    unitCostCents: 800,
    description: "Nail holes and small dings.",
    categoryName: "Prep & Repair",
  },
  {
    name: "Painter's tape, 1.88 in",
    unitOfMeasure: "roll",
    unitCostCents: 750,
    description: "60 yd per roll.",
    categoryName: "Prep & Repair",
  },
  {
    name: "Masking film",
    unitOfMeasure: "roll",
    unitCostCents: 1800,
    description: "Pre-taped plastic for cabinets, windows and floors.",
    categoryName: "Prep & Repair",
  },
  {
    name: "Canvas drop cloth, 9x12",
    unitOfMeasure: "each",
    unitCostCents: 2400,
    description: "Reusable — costed per job at roughly a tenth of replacement.",
    categoryName: "Prep & Repair",
  },
  {
    name: "Roller cover, 3/8 in nap",
    unitOfMeasure: "each",
    unitCostCents: 600,
    description: "One per colour per day on smooth walls.",
    categoryName: "Prep & Repair",
  },
  {
    name: "Sandpaper, assorted grit",
    unitOfMeasure: "pack",
    unitCostCents: 900,
    description: "Scuff-sanding trim and patched areas.",
    categoryName: "Prep & Repair",
  },
] as const;

export const PAINTING_PRICEBOOK: TradePricebook = {
  key: "painting",
  categories: PAINTING_CATEGORIES,
  services: PAINTING_SERVICES,
  materials: PAINTING_MATERIALS,
  // homewyse.com and homeadvisor.com answer automated fetches; every homeguide.com and angi.com
  // link below returns HTTP 403 to a script but resolves fine in a browser. The figure each one
  // supplies is recorded inline next to the line it prices, so a number survives a source a
  // future editor (or agent) cannot re-fetch.
  sources: [
    // Interior surfaces — surface-area basis.
    "https://www.homewyse.com/services/cost_to_paint_wall.html",
    "https://www.homewyse.com/services/cost_to_paint_ceiling.html",
    "https://homeguide.com/costs/cost-to-paint-a-ceiling",
    "https://homeguide.com/costs/wallpaper-removal-cost",
    "https://www.homewyse.com/services/cost_to_remove_popcorn_ceiling_texture.html",
    // Kept for the room-level sanity check ONLY (its bedroom table = $0.77–$2.32 per wall sqft).
    // Its "$2–$6 per square foot" headline is per FLOOR sqft — never import it onto walls_sqft.
    "https://www.homeadvisor.com/cost/painting/paint-a-home-interior/",
    // Trim, doors, windows.
    "https://homeguide.com/costs/cost-to-paint-trim-baseboards",
    "https://www.angi.com/articles/paint-trim-cost.htm",
    "https://www.homewyse.com/services/cost_to_paint_crown_molding.html",
    "https://www.homewyse.com/services/cost_to_paint_door.html",
    "https://www.homewyse.com/services/cost_to_paint_window_trim.html",
    // Exterior.
    "https://homeguide.com/costs/cost-to-paint-exterior-of-house",
    "https://www.homewyse.com/services/cost_to_paint_exterior_trim.html",
    "https://www.homeadvisor.com/cost/painting/powerwash-exterior-surfaces/",
    // Cabinets.
    "https://www.homewyse.com/services/cost_to_paint_kitchen_cabinets.html",
    "https://homeguide.com/costs/cost-to-paint-kitchen-cabinets",
    "https://www.angi.com/articles/how-much-does-it-cost-paint-kitchen-cabinets.htm",
    // Drywall repair — these three disagree by ~3x; see the comment on the patch lines.
    "https://homeguide.com/costs/drywall-repair-cost",
    "https://www.angi.com/articles/how-much-does-drywall-repair-cost-small-holes.htm",
    "https://www.homewyse.com/services/cost_to_repair_drywall_holes.html",
    // Hourly rate and the minimum-fee convention.
    "https://homeguide.com/costs/cost-to-hire-a-painter",
    "https://www.homeadvisor.com/cost/painting/",
  ],
};
