/**
 * app/(public)/q/[token]/LineRow.tsx
 *
 * One quote line row (description × quantity | amount) for the public quote
 * page. Pure markup, no state, no directive — the server page renders it for
 * single-format quotes and the QuoteLines client island renders it for the
 * selected Good/Better/Best tier's fixed lines, so both paths share one row.
 */

import { fmt$ } from "@/lib/format";
import { lineAmountCents } from "./quote-totals";

export interface LineRowProps {
  readonly description: string;
  readonly quantity: number;
  readonly rateCents: number;
  /** Does this line take sales tax. Absent reads as TRUE (see OptionalLineAmount). */
  readonly taxable?: boolean;
  /**
   * Does this document charge tax at all. On a quote with no rate the mark would be noise —
   * nothing is taxed, so saying which lines are not is telling the customer nothing.
   */
  readonly showTaxMark?: boolean;
  /** Scope prose under the description — Includes / Excludes / Products, rendered pre-wrap. */
  readonly scope?: string | null;
  /**
   * Show this line's extended amount. False when the quote's priceDisplay is 'total' — the
   * proposal format: scope + one price at the bottom. The AMOUNT is hidden, never the line.
   */
  readonly showAmount?: boolean;
  /**
   * An assembly whose office chose "Customer sees items": the component names, listed under
   * the line and marked Included — their money already lives in the parent's price.
   */
  readonly includedItems?: readonly string[];
}

export function LineRow({
  description,
  quantity,
  rateCents,
  taxable,
  showTaxMark = false,
  scope,
  showAmount = true,
  includedItems,
}: LineRowProps) {
  const amount = lineAmountCents(quantity, rateCents);
  return (
    <>
      <div className="custline">
        <span>
          {description}
          {quantity !== 1 ? ` × ${quantity}` : ""}
          {showTaxMark && taxable === false && <span className="custline-notax">No tax</span>}
          {scope?.trim() && <span className="custline-scope">{scope}</span>}
        </span>
        {showAmount && <b>{fmt$(amount / 100)}</b>}
      </div>
      {includedItems?.map((name, i) => (
        <div key={i} className="custline custline-included">
          <span>{name}</span>
          <b className="muted">Included</b>
        </div>
      ))}
    </>
  );
}
