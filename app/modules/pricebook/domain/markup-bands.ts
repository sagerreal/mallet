/**
 * The org's ONE cost-banded parts-markup table (Profit Rhino shape): a band applies to
 * costs >= minCostCents up to the next band's floor. Cheap parts marked up hard, big-ticket
 * equipment gently — a flat % destroys margin on a $2 fitting and looks predatory on an
 * $1,800 condenser. A flat-% shop keeps a single $0 band. Orgs with no stored rows use
 * DEFAULT_MARKUP_BANDS — no backfill, and the default is visible/editable from day one.
 */

export interface MarkupBand {
  readonly minCostCents: number;
  readonly markupBps: number;
}

/** Profit-Rhino-shaped default sliding scale. */
export const DEFAULT_MARKUP_BANDS: readonly MarkupBand[] = [
  { minCostCents: 0, markupBps: 30_000 }, // $0–10 → 300%
  { minCostCents: 1_000, markupBps: 20_000 }, // $10–25 → 200%
  { minCostCents: 2_500, markupBps: 10_000 }, // $25–100 → 100%
  { minCostCents: 10_000, markupBps: 5_000 }, // $100–500 → 50%
  { minCostCents: 50_000, markupBps: 2_500 }, // $500+ → 25%
];

/** The band covering a cost: the highest floor ≤ cost. Bands need not be pre-sorted. */
export function bandFor(costCents: number, bands: readonly MarkupBand[]): MarkupBand | null {
  const eligible = bands.filter((b) => b.minCostCents <= Math.max(0, costCents));
  if (eligible.length === 0) return null;
  return eligible.reduce((best, b) => (b.minCostCents > best.minCostCents ? b : best));
}

/**
 * Sell price from cost under the banded rule: cost + cost × markup. Falls back to the
 * DEFAULT bands when the org has none; a cost below every floor sells at cost (never a
 * silent zero, never negative).
 */
export function deriveSellPriceCents(costCents: number, bands: readonly MarkupBand[]): number {
  const table = bands.length > 0 ? bands : DEFAULT_MARKUP_BANDS;
  const band = bandFor(costCents, table);
  if (!band) return Math.max(0, costCents);
  return Math.max(0, Math.round(costCents * (1 + band.markupBps / 10_000)));
}
