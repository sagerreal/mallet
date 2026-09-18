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
  /**
   * Does this line take sales tax. ABSENT READS AS TRUE — the same default the column
   * (`estimate_lines.taxable NOT NULL DEFAULT true`) and the domain
   * (`EstimateLineCreateProps`) carry, so a caller that predates taxability computes the
   * number it always did.
   */
  readonly taxable?: boolean;
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
  /**
   * Sum of the TAXABLE fixed line amounts — Estimate.taxableBase()'s mirror.
   *
   * A SECOND, DIFFERENT number from `fixedSubtotalCents`, not a replacement: a non-taxable line
   * is still in the subtotal and still in the total, it just does not feed the tax. Omitted means
   * every fixed line is taxable, which is what every quote written before taxability existed was.
   */
  readonly fixedTaxableCents?: number;
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

/**
 * Sum of per-line amounts (each rounded first, like Estimate.subtotalOf).
 * Used client-side to derive the SELECTED tier's fixed subtotal on a
 * Good/Better/Best quote — feeds computeQuoteTotals so the tier the customer
 * is looking at recomputes through the same rounding chain the server commits.
 */
export function sumLineAmountsCents(lines: readonly OptionalLineAmount[]): number {
  return lines.reduce(
    (sum, line) => sum + lineAmountCents(line.quantity, line.rateCents),
    0,
  );
}

/**
 * Sum of the TAXABLE lines' amounts (Estimate.taxableBaseOf's mirror). A line with no `taxable`
 * key counts — absent reads as taxable.
 */
export function sumTaxableLineAmountsCents(lines: readonly OptionalLineAmount[]): number {
  return lines.reduce(
    (sum, line) =>
      line.taxable === false ? sum : sum + lineAmountCents(line.quantity, line.rateCents),
    0,
  );
}

/** Derive all quote totals from the fixed subtotal plus the selected optional lines. */
export function computeQuoteTotals(input: QuoteTotalsInput): QuoteTotals {
  const subtotalCents = input.selectedOptionalLines.reduce(
    (sum, line) => sum + lineAmountCents(line.quantity, line.rateCents),
    input.fixedSubtotalCents,
  );
  // Σ(taxable, selected) — the fixed taxable base plus whichever toggled-on add-ons take tax.
  const taxableBaseCents =
    (input.fixedTaxableCents ?? input.fixedSubtotalCents) +
    sumTaxableLineAmountsCents(input.selectedOptionalLines);

  const discountCents = Math.round((subtotalCents * input.discBps) / BPS_DENOMINATOR);
  const netCents = subtotalCents - discountCents;
  // The discount comes off the taxable base at the same rate it comes off the bill — same
  // formula, same rounding, so on an all-taxable quote this IS netCents and the tax is
  // bit-for-bit what it was before taxability existed. (Estimate.totalsFrom, verbatim.)
  const taxableDiscountCents = Math.round((taxableBaseCents * input.discBps) / BPS_DENOMINATOR);
  const taxCents = Math.round(
    ((taxableBaseCents - taxableDiscountCents) * input.taxBps) / BPS_DENOMINATOR,
  );
  const totalCents = netCents + taxCents;
  const depositCents = Math.round((totalCents * input.depBps) / BPS_DENOMINATOR);
  return { subtotalCents, discountCents, taxCents, totalCents, depositCents };
}
