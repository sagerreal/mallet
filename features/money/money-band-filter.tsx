"use client";

import { INVOICE_VIEWS, type InvoiceView } from "@/modules/invoicing/infra/invoice-views";
import { IST } from "./money-derive";

/**
 * features/money/money-band-filter.tsx
 * The one filter on the Money ledger: which band the money is in, with a count on each.
 *
 * Replaces a Status DROPDOWN inside the Filters disclosure. That control worked, but it carried no
 * numbers and answered one band per selection — so on Summit's book the fact that 240 invoices are
 * overdue was two clicks away and invisible until you went looking for it. Counts come from
 * v1.invoicing.viewCounts, one round trip for all five invoice bands.
 *
 * READY TO BILL IS NOT AN INVOICE. It is a finished job nobody has billed, counted by the JOBS
 * module (needsInvoice) and fetched from a different table. It leads the row because it is the one
 * band a single person clears alone, in one click, without waiting on a customer — the same
 * ranking the Customers list uses for "Invoice required". Selecting it suppresses the invoice
 * query entirely rather than passing the invoice list a filter it cannot satisfy.
 *
 * ORDER IS DELIBERATE and is NOT INVOICE_VIEWS' order, nor the invoice lifecycle's. What one
 * person can fix alone comes first, then what the customer owes, worst first:
 *
 *   Ready to bill → Draft → Overdue → Part-paid → Unpaid → Paid
 *
 * The old dropdown ran the lifecycle (Unpaid → Part-paid → Overdue), which left Overdue fifth,
 * sitting next to Paid.
 *
 * ANCHORED AND IN-FLOW per the house rule, and deliberately the same component shape and `.chip`
 * class as JobsViewFilter and CustomersGroupFilter — three lists asking the same kind of question
 * should not have three chip treatments.
 */

/** The ledger band a chip selects. "ready" is the jobs-side worklist; the rest are invoice views. */
export type MoneyBand = "ready" | InvoiceView;

/** Display order — see the note above on why this is not INVOICE_VIEWS' order. */
export const MONEY_BANDS: readonly MoneyBand[] = ["ready", "draft", "over", "partial", "sent", "paid"];

export interface MoneyBandFilterProps {
  /** The selected band, or "" for all of it — the shape the ledger's own filter state uses. */
  readonly band: string;
  /**
   * Per-band counts. A band is omitted while its query is in flight and the count is then simply
   * left off the chip — a 0 that becomes 240 reads as data appearing from nowhere.
   */
  readonly counts: Partial<Record<MoneyBand, number>>;
  readonly onBand: (b: MoneyBand | null) => void;
  /** The archived set owns the list; the filter goes inert rather than vanishing, so nothing jumps. */
  readonly disabled?: boolean;
}

export function MoneyBandFilter({ band, counts, onBand, disabled = false }: MoneyBandFilterProps) {
  return (
    <div className="jh-filters" role="group" aria-label="Filter invoices by band">
      <button
        type="button"
        className={`chip${band === "" ? " on" : ""}`}
        aria-pressed={band === ""}
        disabled={disabled}
        onClick={() => onBand(null)}
      >
        All
      </button>

      {MONEY_BANDS.map((b) => {
        const n = counts[b];
        return (
          <button
            key={b}
            type="button"
            className={`chip${band === b ? " on" : ""}`}
            aria-pressed={band === b}
            disabled={disabled}
            onClick={() => onBand(band === b ? null : b)}
          >
            {/* The chip and the row's pill read the SAME word, off the same table. A filter that
                says "Unpaid" over rows stamped "Sent" is two vocabularies for one idea. */}
            {IST[b]?.l ?? b}
            {n === undefined ? null : <span className="chip-n"> ({n})</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Guard for a value off the URL or component state — never trust a bare string as a band. */
export function isMoneyBand(v: string): v is MoneyBand {
  return v === "ready" || (INVOICE_VIEWS as readonly string[]).includes(v);
}
