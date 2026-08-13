"use client";

import { LEAD_GROUPS, LEAD_GROUP_LABELS, type LeadGroup } from "@/modules/customers/infra/lead-views";

/**
 * features/customers/customers-group-filter.tsx
 * The one filter on the Customers list: where each customer's WORK has got to, with a count.
 *
 * Replaces the Stage / Source / Worklist panel. That panel filtered on `leads.stage` — a stored
 * word somebody sets and nobody maintains — so on a 678-customer book every row read "New
 * customer" and there was nothing in the column to filter BY.
 *
 * These are derived from estimates, visits and invoices, so they cannot go stale, and they are
 * mutually exclusive by construction (see leadGroupCondition) — which is the only reason the counts
 * can be trusted. Seven overlapping counts over a 678-row book would each be right and together be
 * a lie.
 *
 * DELIBERATELY THE SAME COMPONENT SHAPE AS JobsViewFilter, down to the `.chip` class: the two
 * lists ask the same kind of question, and a second chip treatment would be a new visual language
 * for no new idea. Anchored and in-flow per the house rule — this is not a popover.
 */

export interface CustomersGroupFilterProps {
  readonly group: LeadGroup | null;
  /** Per-group counts. Undefined while the query is in flight — the count is then simply omitted. */
  readonly counts: Partial<Record<LeadGroup, number>> | undefined;
  readonly onGroup: (g: LeadGroup | null) => void;
  /** The archived set owns the list; the filter goes inert rather than vanishing, so nothing jumps. */
  readonly disabled?: boolean;
}

export function CustomersGroupFilter({ group, counts, onGroup, disabled = false }: CustomersGroupFilterProps) {
  return (
    <div className="jh-filters" role="group" aria-label="Filter customers by where their work is">
      <button
        type="button"
        className={`chip${group === null ? " on" : ""}`}
        aria-pressed={group === null}
        disabled={disabled}
        onClick={() => onGroup(null)}
      >
        Everyone
      </button>

      {LEAD_GROUPS.map((g) => {
        const n = counts?.[g];
        return (
          <button
            key={g}
            type="button"
            className={`chip${group === g ? " on" : ""}`}
            aria-pressed={group === g}
            disabled={disabled}
            onClick={() => onGroup(group === g ? null : g)}
          >
            {LEAD_GROUP_LABELS[g]}
            {/* Omitted rather than shown as 0 while it loads — a 0 that becomes 12 reads as data
                appearing from nowhere. Same rule as the Jobs filter. */}
            {n === undefined ? null : <span className="chip-n"> ({n})</span>}
          </button>
        );
      })}
    </div>
  );
}
