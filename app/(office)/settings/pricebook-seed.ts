/**
 * app/(office)/settings/pricebook-seed.ts
 * Seed DATA for the "Start with plumbing basics" one-click pack (Task 8) — the content
 * behind the empty-state button on the Settings → Pricebook card. Pure data, no logic:
 * `SeedPricebookUseCase` (modules/pricebook/app/seed-pricebook.ts) is a generic, vertical-
 * agnostic use-case that the v1.pricebook.seed router procedure feeds this pack into, so
 * the module itself never hardcodes "plumbing". All prices/costs for a residential
 * plumbing shop are flat-rate estimates; no magic numbers live outside this file.
 *
 * Money: integer cents (unitPriceCents/costCents), matching CreateServiceCommand/DTO —
 * conversion to store dollars happens only in lib/store/pricebook-mapper.ts.
 */

export const PLUMBING_SEED_CATEGORIES = [
  "Water Heaters",
  "Drains & Sewer",
  "Fixtures",
  "Repairs",
  "Gas",
  "Service & Diagnostic",
] as const;

export type PlumbingSeedCategoryName = (typeof PLUMBING_SEED_CATEGORIES)[number];

export interface PlumbingSeedService {
  readonly name: string;
  readonly categoryName: PlumbingSeedCategoryName;
  readonly unitPriceCents: number;
  readonly costCents: number;
}

export const PLUMBING_SEED_SERVICES: readonly PlumbingSeedService[] = [
  // ── Water Heaters ──────────────────────────────────────────────────────────
  { name: "Replace 40gal gas water heater", categoryName: "Water Heaters", unitPriceCents: 240000, costCents: 118000 },
  { name: "Replace 50gal gas water heater", categoryName: "Water Heaters", unitPriceCents: 265000, costCents: 132000 },
  { name: "Replace 40gal electric water heater", categoryName: "Water Heaters", unitPriceCents: 210000, costCents: 98000 },
  { name: "Replace 50gal electric water heater", categoryName: "Water Heaters", unitPriceCents: 235000, costCents: 112000 },
  { name: "Install tankless water heater", categoryName: "Water Heaters", unitPriceCents: 385000, costCents: 195000 },
  { name: "Water heater tune-up / flush", categoryName: "Water Heaters", unitPriceCents: 18500, costCents: 4500 },
  { name: "Replace T&P relief valve", categoryName: "Water Heaters", unitPriceCents: 32500, costCents: 9000 },
  { name: "Water heater thermostat/element repair", categoryName: "Water Heaters", unitPriceCents: 27500, costCents: 8500 },

  // ── Drains & Sewer ──────────────────────────────────────────────────────────
  { name: "Drain cleaning — kitchen", categoryName: "Drains & Sewer", unitPriceCents: 22500, costCents: 4000 },
  { name: "Drain cleaning — bathroom", categoryName: "Drains & Sewer", unitPriceCents: 19500, costCents: 3500 },
  { name: "Drain cleaning — main line", categoryName: "Drains & Sewer", unitPriceCents: 32500, costCents: 6500 },
  { name: "Hydro-jet main line", categoryName: "Drains & Sewer", unitPriceCents: 45000, costCents: 9000 },
  { name: "Camera inspection w/ locate", categoryName: "Drains & Sewer", unitPriceCents: 28500, costCents: 6000 },
  { name: "Sewer line repair (spot repair)", categoryName: "Drains & Sewer", unitPriceCents: 185000, costCents: 82000 },
  { name: "Sewer line replacement (per section)", categoryName: "Drains & Sewer", unitPriceCents: 450000, costCents: 220000 },
  { name: "Root removal / clearing", categoryName: "Drains & Sewer", unitPriceCents: 27500, costCents: 5000 },

  // ── Fixtures ──────────────────────────────────────────────────────────────
  { name: "Toilet reset", categoryName: "Fixtures", unitPriceCents: 22000, costCents: 4000 },
  { name: "Toilet replacement (customer-supplied)", categoryName: "Fixtures", unitPriceCents: 27500, costCents: 6000 },
  { name: "Toilet replacement (incl. standard toilet)", categoryName: "Fixtures", unitPriceCents: 42500, costCents: 18500 },
  { name: "Faucet replacement — kitchen", categoryName: "Fixtures", unitPriceCents: 32500, costCents: 11000 },
  { name: "Faucet replacement — bathroom", categoryName: "Fixtures", unitPriceCents: 27500, costCents: 8500 },
  { name: "Garbage disposal install/replace", categoryName: "Fixtures", unitPriceCents: 34500, costCents: 14500 },
  { name: "Sink replacement", categoryName: "Fixtures", unitPriceCents: 38500, costCents: 15000 },
  { name: "Shower valve replacement", categoryName: "Fixtures", unitPriceCents: 47500, costCents: 17500 },

  // ── Repairs ───────────────────────────────────────────────────────────────
  { name: "Fix running toilet", categoryName: "Repairs", unitPriceCents: 16500, costCents: 2500 },
  { name: "Repair/replace shut-off valve", categoryName: "Repairs", unitPriceCents: 24500, costCents: 6000 },
  { name: "Slab leak repair", categoryName: "Repairs", unitPriceCents: 385000, costCents: 165000 },
  { name: "Pipe repair (visible, per section)", categoryName: "Repairs", unitPriceCents: 32500, costCents: 9500 },
  { name: "Repipe (per fixture)", categoryName: "Repairs", unitPriceCents: 65000, costCents: 27500 },

  // ── Gas ───────────────────────────────────────────────────────────────────
  { name: "Gas line install (per appliance hookup)", categoryName: "Gas", unitPriceCents: 47500, costCents: 18500 },
  { name: "Gas leak detection & repair", categoryName: "Gas", unitPriceCents: 42500, costCents: 14500 },
  { name: "Gas line pressure test", categoryName: "Gas", unitPriceCents: 22500, costCents: 4000 },

  // ── Service & Diagnostic ────────────────────────────────────────────────────
  { name: "Diagnostic / trip fee", categoryName: "Service & Diagnostic", unitPriceCents: 9500, costCents: 0 },
  { name: "Emergency after-hours call", categoryName: "Service & Diagnostic", unitPriceCents: 22500, costCents: 0 },
  { name: "Annual plumbing inspection", categoryName: "Service & Diagnostic", unitPriceCents: 18500, costCents: 4000 },
  { name: "Backflow preventer test", categoryName: "Service & Diagnostic", unitPriceCents: 15500, costCents: 3000 },
];
