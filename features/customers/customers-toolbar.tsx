/**
 * features/customers/customers-toolbar.tsx
 * Search input + Filters + Columns controls (§4.3).
 * Pure presentational — all state passed as props/callbacks.
 */

"use client";

interface ToolbarProps {
  q: string;
  onQ: (v: string) => void;
  filtersOpen: boolean;
  onToggleFilters: () => void;
  colsOpen: boolean;
  onToggleCols: () => void;
  activeFilterCount: number;
  total: number;
  filtered: number;
}

export function CustomersToolbar({
  q,
  onQ,
  filtersOpen,
  onToggleFilters,
  colsOpen,
  onToggleCols,
  activeFilterCount,
  total,
  filtered,
}: ToolbarProps) {
  return (
    <div className="toolbar">
      <input
        type="text"
        aria-label="Search customers"
        placeholder="Search name, phone, job, email…"
        value={q}
        onChange={(e) => onQ(e.target.value)}
      />
      <button
        className={`btn${filtersOpen || activeFilterCount > 0 ? "" : " ghost"}`}
        onClick={onToggleFilters}
      >
        Filters
        {activeFilterCount > 0 && (
          <span className="pill amber" style={{ marginLeft: 4 }}>
            {activeFilterCount}
          </span>
        )}
      </button>
      <button className="btn ghost" onClick={onToggleCols}>
        Columns ▾
      </button>
      <span className="muted" style={{ marginLeft: "auto" }}>
        {filtered} of {total}
      </span>
    </div>
  );
}
