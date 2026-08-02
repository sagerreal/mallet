import type { AssemblyConfig } from "./assembly-config";
import type { AssemblyDial } from "./assembly-dials";

/**
 * The shipped assembly catalog — market-researched paving/hardscape recipes
 * every org starts with. NOTHING here is seeded into the DB: list-assemblies
 * resolves these at read time whenever the org has no override row for a key
 * (the pricebook's starter pack is an explicit one-shot button, so there was no
 * lazy-seed precedent to follow — read-time resolution keeps orgs zero-row
 * until they actually edit). Editing any dial materializes ONE override row
 * keyed by catalogKey (copy-on-write); per-field "reset" writes the catalog
 * value back through the same dial.
 *
 * CATALOG_VERSION stamps the defaults so a future constants revision can tell
 * "org never touched this" from "org saw v1 defaults". Constants sourced from
 * the estimating research (TruTec cost recipes / Roofr / AccuLynx / OneCrew
 * models); the worked examples in compute-assembly.test.ts pin them.
 */

export const CATALOG_VERSION = 1;

export interface CatalogAssembly {
  readonly catalogKey: string;
  readonly name: string;
  readonly measurementBasis: "area" | "perimeter";
  readonly pricingMode: "cost_plus" | "unit_rate";
  readonly marginBps: number;
  readonly jobMinimumCents: number;
  readonly position: number;
  readonly config: AssemblyConfig;
  /** The org-tunable constants, with trade-vocabulary labels, in display order. */
  readonly dials: readonly AssemblyDial[];
}

// Conversion constants (industry-standard):
// - 324 sqft·in per cubic yard (12 × 27)
// - aggregate ≈ 1.5 tons per cubic yard → tons = sqft × depth_in × 1.5/324
// - hot-mix asphalt ≈ 145 lb per sqft·in ÷ 2000 lb/ton → tons = sqft × depth_in × 145/24000
const STONE_TONS_PER_SQFT_IN = 1.5 / 324;
const HMA_TONS_PER_SQFT_IN = 145 / 24000;
// Sealcoat: coat 1 at 75 sqft/gal + coat 2 at 110 sqft/gal, mixed 1.4:1 from concentrate.
const SEALER_GAL_PER_SQFT = (1 / 75 + 1 / 110) / 1.4;

const DRIVEWAY_REPLACEMENT: CatalogAssembly = {
  catalogKey: "driveway_replacement_3in",
  name: "Driveway replacement, 3-inch",
  measurementBasis: "area",
  pricingMode: "cost_plus",
  marginBps: 2500,
  jobMinimumCents: 250_000,
  position: 0,
  config: {
    version: 1,
    components: [
      { kind: "labor", key: "demo", label: "Demolition and haul-off", basis: "area", mode: "per_unit", unitsPerDay: null, unitsPerHour: null, rateCents: 175 },
      { kind: "labor", key: "grading", label: "Grading and compaction", basis: "area", mode: "per_unit", unitsPerDay: null, unitsPerHour: null, rateCents: 70 },
      { kind: "material", key: "base", label: "Base stone, 2 in", basis: "area", factors: [2, STONE_TONS_PER_SQFT_IN], wasteFactor: 1, packSize: 0.5, unit: "tons", unitCostCents: 4000 },
      { kind: "material", key: "hma", label: "Hot-mix asphalt, 3 in", basis: "area", factors: [3, HMA_TONS_PER_SQFT_IN], wasteFactor: 1.07, packSize: 0.5, unit: "tons", unitCostCents: 12000 },
      { kind: "equipment", key: "trucking", label: "Trucking", source: { componentKey: "hma" }, perQuantity: 20, unit: "loads", rateCents: 45000 },
      { kind: "labor", key: "crew", label: "Paving crew", basis: "area", mode: "crew_day", unitsPerDay: 2500, unitsPerHour: null, rateCents: 300000 },
      { kind: "fixed", key: "mob", label: "Mobilization", amountCents: 50000 },
    ],
    tiers: null,
  },
  dials: [
    { key: "depth", label: "Asphalt depth", format: "number", unitSuffix: "in", target: { kind: "componentFactor", componentKey: "hma", index: 0 } },
    { key: "hma_price", label: "Hot-mix price", format: "dollars", unitSuffix: "per ton", target: { kind: "componentField", componentKey: "hma", field: "unitCostCents" } },
    { key: "waste", label: "Waste", format: "wastePercent", target: { kind: "componentField", componentKey: "hma", field: "wasteFactor" } },
    { key: "base_price", label: "Base stone price", format: "dollars", unitSuffix: "per ton", target: { kind: "componentField", componentKey: "base", field: "unitCostCents" } },
    { key: "demo_rate", label: "Demo and haul-off", format: "dollars", unitSuffix: "per sq ft", target: { kind: "componentField", componentKey: "demo", field: "rateCents" } },
    { key: "grading_rate", label: "Grading", format: "dollars", unitSuffix: "per sq ft", target: { kind: "componentField", componentKey: "grading", field: "rateCents" } },
    { key: "truck_rate", label: "Trucking", format: "dollars", unitSuffix: "per load", target: { kind: "componentField", componentKey: "trucking", field: "rateCents" } },
    { key: "crew_day", label: "Paving crew day", format: "dollars", unitSuffix: "per day", target: { kind: "componentField", componentKey: "crew", field: "rateCents" } },
    { key: "crew_prod", label: "Paving per day", format: "number", unitSuffix: "sq ft", target: { kind: "componentField", componentKey: "crew", field: "unitsPerDay" } },
    { key: "mobilization", label: "Mobilization", format: "dollars", target: { kind: "componentField", componentKey: "mob", field: "amountCents" } },
    { key: "margin", label: "Margin", format: "percentBps", target: { kind: "marginBps" } },
    { key: "job_min", label: "Job minimum", format: "dollars", target: { kind: "jobMinimumCents" } },
  ],
};

const ASPHALT_OVERLAY: CatalogAssembly = {
  catalogKey: "asphalt_overlay_15in",
  name: "Asphalt overlay, 1.5-inch",
  measurementBasis: "area",
  pricingMode: "cost_plus",
  marginBps: 2500,
  jobMinimumCents: 0,
  position: 1,
  config: {
    version: 1,
    components: [
      { kind: "material", key: "hma", label: "Hot-mix asphalt, 1.5 in", basis: "area", factors: [1.5, HMA_TONS_PER_SQFT_IN], wasteFactor: 1.07, packSize: 0.5, unit: "tons", unitCostCents: 12000 },
      // 1 gal covers 9 sqft at 0.07 gal/sqyd → sqft × (1/9) × 0.07 gallons.
      { kind: "material", key: "tack", label: "Tack coat", basis: "area", factors: [1 / 9, 0.07], wasteFactor: 1, packSize: 1, unit: "gal", unitCostCents: 1200 },
      { kind: "labor", key: "milling", label: "Edge milling", basis: "perimeter", mode: "per_unit", unitsPerDay: null, unitsPerHour: null, rateCents: 200, optional: true },
      { kind: "labor", key: "crew", label: "Paving crew", basis: "area", mode: "crew_day", unitsPerDay: 5000, unitsPerHour: null, rateCents: 300000 },
      { kind: "fixed", key: "mob", label: "Mobilization", amountCents: 50000 },
    ],
    tiers: null,
  },
  dials: [
    { key: "depth", label: "Overlay depth", format: "number", unitSuffix: "in", target: { kind: "componentFactor", componentKey: "hma", index: 0 } },
    { key: "hma_price", label: "Hot-mix price", format: "dollars", unitSuffix: "per ton", target: { kind: "componentField", componentKey: "hma", field: "unitCostCents" } },
    { key: "waste", label: "Waste", format: "wastePercent", target: { kind: "componentField", componentKey: "hma", field: "wasteFactor" } },
    { key: "tack_price", label: "Tack coat price", format: "dollars", unitSuffix: "per gal", target: { kind: "componentField", componentKey: "tack", field: "unitCostCents" } },
    { key: "milling_rate", label: "Edge milling", format: "dollars", unitSuffix: "per ln ft", target: { kind: "componentField", componentKey: "milling", field: "rateCents" } },
    { key: "crew_day", label: "Paving crew day", format: "dollars", unitSuffix: "per day", target: { kind: "componentField", componentKey: "crew", field: "rateCents" } },
    { key: "crew_prod", label: "Paving per day", format: "number", unitSuffix: "sq ft", target: { kind: "componentField", componentKey: "crew", field: "unitsPerDay" } },
    { key: "mobilization", label: "Mobilization", format: "dollars", target: { kind: "componentField", componentKey: "mob", field: "amountCents" } },
    { key: "margin", label: "Margin", format: "percentBps", target: { kind: "marginBps" } },
  ],
};

const SEALCOAT: CatalogAssembly = {
  catalogKey: "sealcoat_two_coats",
  name: "Sealcoat, two coats",
  measurementBasis: "area",
  pricingMode: "unit_rate",
  marginBps: 0,
  jobMinimumCents: 35_000,
  position: 2,
  config: {
    version: 1,
    components: [
      { kind: "material", key: "sealer", label: "Sealer concentrate", basis: "area", factors: [SEALER_GAL_PER_SQFT], wasteFactor: 1, packSize: 1, unit: "gal", unitCostCents: 350 },
      // 3 lb sand per gallon of concentrate, bought in 50 lb bags.
      { kind: "material", key: "sand", label: "Silica sand", basis: "area", factors: [SEALER_GAL_PER_SQFT * 3], wasteFactor: 1, packSize: 50, unit: "lb", unitCostCents: 16 },
      { kind: "labor", key: "crew", label: "Sealcoat crew", basis: "area", mode: "hourly", unitsPerDay: null, unitsPerHour: 750, rateCents: 8000 },
    ],
    tiers: [
      { upToQty: 2000, rateCents: 25 },
      { upToQty: 5000, rateCents: 22 },
      { upToQty: null, rateCents: 18 },
    ],
  },
  dials: [
    { key: "sealer_price", label: "Sealer price", format: "dollars", unitSuffix: "per gal", target: { kind: "componentField", componentKey: "sealer", field: "unitCostCents" } },
    { key: "crew_rate", label: "Crew rate", format: "dollars", unitSuffix: "per hour", target: { kind: "componentField", componentKey: "crew", field: "rateCents" } },
    { key: "rate_small", label: "Rate up to 2,000 sq ft", format: "dollars", unitSuffix: "per sq ft", target: { kind: "tierRate", index: 0 } },
    { key: "rate_mid", label: "Rate up to 5,000 sq ft", format: "dollars", unitSuffix: "per sq ft", target: { kind: "tierRate", index: 1 } },
    { key: "rate_large", label: "Rate over 5,000 sq ft", format: "dollars", unitSuffix: "per sq ft", target: { kind: "tierRate", index: 2 } },
    { key: "job_min", label: "Job minimum", format: "dollars", target: { kind: "jobMinimumCents" } },
  ],
};

const CRACK_FILLING: CatalogAssembly = {
  catalogKey: "crack_filling",
  name: "Crack filling",
  measurementBasis: "perimeter",
  pricingMode: "unit_rate",
  marginBps: 0,
  jobMinimumCents: 0,
  position: 3,
  config: {
    version: 1,
    components: [
      // One 30 lb box of hot-pour covers ~275 lnft.
      { kind: "material", key: "hotpour", label: "Hot-pour crack filler", basis: "perimeter", factors: [1 / 275], wasteFactor: 1, packSize: 1, unit: "boxes", unitCostCents: 6000 },
    ],
    tiers: [{ upToQty: null, rateCents: 150 }],
  },
  dials: [
    { key: "box_price", label: "Filler box price", format: "dollars", unitSuffix: "per box", target: { kind: "componentField", componentKey: "hotpour", field: "unitCostCents" } },
    { key: "rate", label: "Rate", format: "dollars", unitSuffix: "per ln ft", target: { kind: "tierRate", index: 0 } },
  ],
};

const PAVER_DRIVEWAY: CatalogAssembly = {
  catalogKey: "paver_driveway",
  name: "Paver driveway",
  measurementBasis: "area",
  pricingMode: "unit_rate",
  marginBps: 0,
  jobMinimumCents: 300_000,
  position: 4,
  config: {
    version: 1,
    components: [
      { kind: "material", key: "pavers", label: "Pavers", basis: "area", factors: [1], wasteFactor: 1.07, packSize: null, unit: "sqft", unitCostCents: 350 },
      // 1 in bedding sand: sqft × 0.0031 yd³, 15% waste.
      { kind: "material", key: "sand", label: "Bedding sand", basis: "area", factors: [0.0031], wasteFactor: 1.15, packSize: 0.5, unit: "yd3", unitCostCents: 4500 },
      { kind: "material", key: "base", label: "Base stone, 8 in", basis: "area", factors: [8, STONE_TONS_PER_SQFT_IN], wasteFactor: 1, packSize: 0.5, unit: "tons", unitCostCents: 4000 },
      { kind: "material", key: "edge", label: "Edge restraint", basis: "perimeter", factors: [1], wasteFactor: 1, packSize: null, unit: "lnft", unitCostCents: 650 },
      { kind: "labor", key: "install", label: "Install labor", basis: "area", mode: "per_unit", unitsPerDay: null, unitsPerHour: null, rateCents: 600 },
    ],
    tiers: [
      { upToQty: 500, rateCents: 2500 },
      { upToQty: 1500, rateCents: 2200 },
      { upToQty: null, rateCents: 2000 },
    ],
  },
  dials: [
    { key: "paver_cost", label: "Paver cost", format: "dollars", unitSuffix: "per sq ft", target: { kind: "componentField", componentKey: "pavers", field: "unitCostCents" } },
    { key: "base_depth", label: "Base depth", format: "number", unitSuffix: "in", target: { kind: "componentFactor", componentKey: "base", index: 0 } },
    { key: "edge_cost", label: "Edge restraint", format: "dollars", unitSuffix: "per ln ft", target: { kind: "componentField", componentKey: "edge", field: "unitCostCents" } },
    { key: "install_rate", label: "Install labor", format: "dollars", unitSuffix: "per sq ft", target: { kind: "componentField", componentKey: "install", field: "rateCents" } },
    { key: "rate_small", label: "Rate up to 500 sq ft", format: "dollars", unitSuffix: "per sq ft", target: { kind: "tierRate", index: 0 } },
    { key: "rate_mid", label: "Rate up to 1,500 sq ft", format: "dollars", unitSuffix: "per sq ft", target: { kind: "tierRate", index: 1 } },
    { key: "rate_large", label: "Rate over 1,500 sq ft", format: "dollars", unitSuffix: "per sq ft", target: { kind: "tierRate", index: 2 } },
    { key: "job_min", label: "Job minimum", format: "dollars", target: { kind: "jobMinimumCents" } },
  ],
};

export const DEFAULT_ASSEMBLIES: readonly CatalogAssembly[] = [
  DRIVEWAY_REPLACEMENT,
  ASPHALT_OVERLAY,
  SEALCOAT,
  CRACK_FILLING,
  PAVER_DRIVEWAY,
];

export function catalogAssemblyByKey(key: string): CatalogAssembly | null {
  return DEFAULT_ASSEMBLIES.find((assembly) => assembly.catalogKey === key) ?? null;
}
