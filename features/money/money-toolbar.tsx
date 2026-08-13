"use client";

/**
 * features/money/money-toolbar.tsx
 * The Money toolbar — the Active/Archived set toggle, the search, and the "N of M" readout.
 *
 * Filters and Columns are gone, with both of their panels. Filters held a Status DROPDOWN carrying
 * no numbers and answering one band per selection, so the fact that 240 invoices are overdue was
 * two clicks away; MoneyBandFilter renders that as a chip row on the page instead. Columns picked
 * from a set that is now fixed at five load-bearing columns — the same call Jobs and Customers made.
 * Presentational — the ledger owns the state.
 */

import { ViewToggle } from "@/components/shared/view-toggle";

export type MoneySet = "active" | "archived";

export interface MoneyToolbarProps {
  moneySet: MoneySet;
  onMoneySet: (v: MoneySet) => void;
  q: string;
  onQ: (v: string) => void;
  shown: number;
  total: number;
}

export function MoneyToolbar({
  moneySet,
  onMoneySet,
  q,
  onQ,
  shown,
  total,
}: MoneyToolbarProps) {
  return (
    <div className="toolbar">
      <ViewToggle
        value={moneySet}
        options={[{ value: "active", label: "Active" }, { value: "archived", label: "Archived" }]}
        onChange={onMoneySet}
        ariaLabel="Show active or archived invoices"
      />
      <div className="toolbar-search">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="7"/>
          <line x1="16.5" y1="16.5" x2="22" y2="22"/>
        </svg>
        <input
          enterKeyHint="search"
          type="text"
          aria-label="Search invoices"
          placeholder="Search #, customer, job…"
          value={q}
          onChange={(e) => onQ(e.target.value)}
        />
      </div>
      <span className="muted" style={{ marginLeft: "auto" }}>
        {shown} of {total}
      </span>
    </div>
  );
}
