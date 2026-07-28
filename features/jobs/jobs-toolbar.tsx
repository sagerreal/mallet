"use client";

/**
 * features/jobs/jobs-toolbar.tsx
 * The Jobs list toolbar — the Active/Archived set toggle + search + Filters +
 * Columns. The toggle picks which SET you're looking at (kept separate from the
 * Status filter, which narrows the active set). Pure presentational.
 */

import { ViewToggle } from "@/components/shared/view-toggle";
import type { JobsArchiveSet } from "./jobs-list-config";

interface JobsToolbarProps {
  archiveSet: JobsArchiveSet;
  onArchiveSet: (v: JobsArchiveSet) => void;
  q: string;
  onQ: (v: string) => void;
  filtersOpen: boolean;
  onToggleFilters: () => void;
  colsOpen: boolean;
  onToggleCols: () => void;
  activeFilterCount: number;
  total: number;
  shown: number;
}

export function JobsToolbar({
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
  shown,
}: JobsToolbarProps) {
  return (
    <div className="toolbar">
      <ViewToggle
        value={archiveSet}
        options={[{ value: "active", label: "Active" }, { value: "archived", label: "Archived" }]}
        onChange={onArchiveSet}
        ariaLabel="Show active or archived jobs"
      />
      <div className="toolbar-search">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="7"/>
          <line x1="16.5" y1="16.5" x2="22" y2="22"/>
        </svg>
        <input
          enterKeyHint="search"
          type="text"
          aria-label="Search jobs"
          placeholder="Search customer, job, address…"
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
          <span className="pill amber" style={{ marginLeft: "var(--space-1)" }}>
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
