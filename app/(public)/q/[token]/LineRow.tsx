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
}

export function LineRow({ description, quantity, rateCents }: LineRowProps) {
  const amount = lineAmountCents(quantity, rateCents);
  return (
    <div className="custline">
      <span>
        {description}
        {quantity !== 1 ? ` × ${quantity}` : ""}
      </span>
      <b>{fmt$(amount / 100)}</b>
    </div>
  );
}
