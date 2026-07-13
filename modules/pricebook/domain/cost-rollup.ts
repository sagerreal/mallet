// Pure cost-rollup calculations — no repository/DB dependencies. A service's cost basis is
// advisory (shown as "parts cost $X"); it never overwrites the service's flat unit_price_cents.

// Sum of unit cost × quantity across a service's attached materials. Each line is rounded to
// the nearest cent before summing (money is always integer cents).
export const serviceCostBasisCents = (
  attached: readonly { unitCostCents: number; quantity: number }[],
): number => attached.reduce((total, line) => total + Math.round(line.unitCostCents * line.quantity), 0);

// A material's effective markup: its own override if set, else the org default.
export const effectiveMarkupBps = (
  materialMarkupBps: number | null,
  orgDefaultBps: number,
): number => materialMarkupBps ?? orgDefaultBps;

// The material's marked-up price at its effective markup (for found-work pricing, later phase).
export const markedUpPriceCents = (unitCostCents: number, effectiveBps: number): number =>
  Math.round(unitCostCents * (1 + effectiveBps / 10000));
