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
}

export function LineRow({
  description,
  quantity,
  rateCents,
  taxable,
  showTaxMark = false,
}: LineRowProps) {
  const amount = lineAmountCents(quantity, rateCents);
  return (
    <div className="custline">
      <span>
        {description}
        {quantity !== 1 ? ` × ${quantity}` : ""}
        {showTaxMark && taxable === false && <span className="custline-notax">No tax</span>}
      </span>
      <b>{fmt$(amount / 100)}</b>
    </div>
  );
}
