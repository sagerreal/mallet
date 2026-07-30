/**
 * features/customers/customers-toolbar.tsx
 * The Customers toolbar — the Active/Archived set toggle + search + Filters +
 * Columns, matching the Jobs toolbar. The toggle picks which SET you're viewing;
 * the Status/Source filters narrow within it. Pure presentational.
 */

"use client";

import { ViewToggle } from "@/components/shared/view-toggle";

export type CustomerArchiveSet = "active" | "archived";

interface ToolbarProps {
  archiveSet: CustomerArchiveSet;
  onArchiveSet: (v: CustomerArchiveSet) => void;
  q: string;
  onQ: (v: string) => void;
  filtersOpen: boolean;
  onToggleFilters: () => void;
  colsOpen: boolean;
  onToggleCols: () => void;
  activeFilterCount: number;
  total: number;
  filtered: number;
  /** True while the caller's backing list is on its first load — the count renders as a skeleton. */
  countsLoading?: boolean;
  /** Search input placeholder (differs for People vs Companies). */
  searchPlaceholder?: string;
  /** Filters/Columns only apply to the People table — hidden for Companies. */
  showControls?: boolean;
}

export function CustomersToolbar({
  archiveSet,
  onArchiveSet,
  q,
  onQ,
  filtersOpen,
  onToggleFilters,
  colsOpen,
  onToggleCols,
  activeFilterCount,
  total,
  filtered,
  countsLoading = false,
  searchPlaceholder = "Search name, phone, job, email…",
  showControls = true,
}: ToolbarProps) {
  return (
    <div className="toolbar">
      <ViewToggle
        value={archiveSet}
        options={[{ value: "active", label: "Active" }, { value: "archived", label: "Archived" }]}
        onChange={onArchiveSet}
        ariaLabel="Show active or archived customers"
      />
      <div className="toolbar-search">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="7"/>
          <line x1="16.5" y1="16.5" x2="22" y2="22"/>
        </svg>
        <input
          type="text"
          aria-label="Search customers"
          placeholder={searchPlaceholder}
          value={q}
          onChange={(e) => onQ(e.target.value)}
        />
      </div>
      {showControls && (
        <>
          <button
            className={`btn${filtersOpen || activeFilterCount > 0 ? "" : " ghost"}`}
            aria-expanded={filtersOpen}
            onClick={onToggleFilters}
          >
            Filters
            {activeFilterCount > 0 && (
              <span className="pill amber" style={{ marginLeft: "var(--space-1)" }}>
                {activeFilterCount}
              </span>
            )}
          </button>
          <button className="btn ghost cols-btn" aria-expanded={colsOpen} onClick={onToggleCols}>
            Columns ▾
          </button>
        </>
      )}
      <span className="muted" style={{ marginLeft: "auto" }}>
        {/* countsLoading: the caller's list hasn't hydrated — "0 of 0" would be a false count. */}
        {countsLoading ? (
          <span className="sk" style={{ display: "inline-block", width: 44, height: 10 }} aria-hidden="true" />
        ) : (
          <>{filtered} of {total}</>
        )}
      </span>
    </div>
  );
}
