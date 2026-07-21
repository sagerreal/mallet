"use client";

/**
 * features/money/money-toolbar.tsx
 * The Money toolbar (Active/Archived toggle + search + Filters + Columns +
 * count) and its two panels. Presentational — the ledger owns the state.
 */

import { ViewToggle } from "@/components/shared/view-toggle";
import { IST, type MoneyStatusKey } from "./money-derive";
import { MONEY_COLS, MONEY_COL_ORDER, type MoneyColKey } from "./money-table";

export type MoneySet = "active" | "archived";

const STATUS_FILTERS: readonly MoneyStatusKey[] = ["ready", "draft", "sent", "partial", "over", "paid"];

export interface MoneyToolbarProps {
  moneySet: MoneySet;
  onMoneySet: (v: MoneySet) => void;
  q: string;
  onQ: (v: string) => void;
  filtersOpen: boolean;
  onToggleFilters: () => void;
  colsOpen: boolean;
  onToggleCols: () => void;
  activeFilterCount: number;
  shown: number;
  total: number;
}

export function MoneyToolbar({
  moneySet,
  onMoneySet,
  q,
  onQ,
  filtersOpen,
  onToggleFilters,
  colsOpen,
  onToggleCols,
  activeFilterCount,
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
          type="text"
          aria-label="Search invoices"
          placeholder="Search #, customer, job…"
          value={q}
          onChange={(e) => onQ(e.target.value)}
        />
      </div>
      <button
        className={`btn${filtersOpen || activeFilterCount > 0 ? "" : " ghost"}`}
        aria-expanded={filtersOpen}
        onClick={onToggleFilters}
      >
        Filters
        {activeFilterCount > 0 && (
          <span className="pill amber" style={{ marginLeft: "var(--space-2xs)" }}>
            {activeFilterCount}
          </span>
        )}
      </button>
      <button className="btn ghost cols-btn" aria-expanded={colsOpen} onClick={onToggleCols}>
        Columns ▾
      </button>
      <span className="muted" style={{ marginLeft: "auto" }}>
        {shown} of {total}
      </span>
    </div>
  );
}

export function MoneyColumnsPanel({ visible, onToggle }: { visible: MoneyColKey[]; onToggle: (k: MoneyColKey) => void }) {
  return (
    <div className="fpanel" style={{ gap: "var(--space-2)" }}>
      {MONEY_COL_ORDER.map((c) => (
        <label key={c} className="colchk">
          <input type="checkbox" checked={visible.includes(c)} onChange={() => onToggle(c)} />
          {MONEY_COLS[c].l}
        </label>
      ))}
    </div>
  );
}

export function MoneyFiltersPanel({
  statusFilter,
  onStatus,
  onClear,
}: {
  statusFilter: string;
  onStatus: (v: string) => void;
  onClear: () => void;
}) {
  return (
    <div className="fpanel">
      <div className="field">
        <label htmlFor="money-filter-status">Status</label>
        <select id="money-filter-status" value={statusFilter} onChange={(e) => onStatus(e.target.value)}>
          <option value="">Any</option>
          {STATUS_FILTERS.map((k) => (
            <option key={k} value={k}>
              {IST[k]?.l ?? k}
            </option>
          ))}
        </select>
      </div>
      <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "center" }}>
        <span className="linklike" onClick={onClear}>
          Clear all
        </span>
      </div>
    </div>
  );
}
