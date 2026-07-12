/**
 * app/(public)/q/[token]/quote-totals.ts
 *
 * Pure cents math for the public quote page's live totals. Mirrors the domain's
 * derivations in modules/quoting/domain/estimate.ts (subtotal → discount → net →
 * tax → total → deposit) EXACTLY, including per-step Math.round, so the number the
 * customer approves on the client matches what the server commits on accept.
 *
 * Unit-tested against the domain model itself (quote-totals.test.ts).
 */

const BPS_DENOMINATOR = 10_000; // basis points: 10000 bps = 100%

export interface OptionalLineAmount {
  readonly quantity: number;
  readonly rateCents: number;
}

export interface QuoteTotals {
  readonly subtotalCents: number;
  readonly discountCents: number;
  readonly taxCents: number;
  readonly totalCents: number;
  readonly depositCents: number;
}

export interface QuoteTotalsInput {
  /** Sum of the fixed (non-optional) line amounts, already rounded server-side. */
  readonly fixedSubtotalCents: number;
  /** The optional add-on lines the customer has toggled ON. */
  readonly selectedOptionalLines: readonly OptionalLineAmount[];
  readonly discBps: number;
  readonly taxBps: number;
  readonly depBps: number;
}

/** Extended line amount = quantity × unit rate, rounded to whole cents (EstimateLine.amount). */
export function lineAmountCents(quantity: number, rateCents: number): number {
  return Math.round(quantity * rateCents);
}

/** Derive all quote totals from the fixed subtotal plus the selected optional lines. */
export function computeQuoteTotals(input: QuoteTotalsInput): QuoteTotals {
  const subtotalCents = input.selectedOptionalLines.reduce(
    (sum, line) => sum + lineAmountCents(line.quantity, line.rateCents),
    input.fixedSubtotalCents,
  );
  const discountCents = Math.round((subtotalCents * input.discBps) / BPS_DENOMINATOR);
  const netCents = subtotalCents - discountCents;
  const taxCents = Math.round((netCents * input.taxBps) / BPS_DENOMINATOR);
  const totalCents = netCents + taxCents;
  const depositCents = Math.round((totalCents * input.depBps) / BPS_DENOMINATOR);
  return { subtotalCents, discountCents, taxCents, totalCents, depositCents };
}
