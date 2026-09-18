"use client";

/**
 * features/jobs/jobs-toolbar.tsx
 * The Jobs list toolbar — the Active/Archived set toggle, the search, and the "N of M" readout.
 *
 * Filters and Columns are gone. Filters opened the chip row, which now renders in the page
 * unconditionally — a count pill on a button that opens the row it counts is a second, worse copy
 * of the same fact. Columns picked from a set that is now fixed at four load-bearing columns.
 * The toggle picks which SET you are looking at, kept separate from the chips, which narrow within
 * the active set. Pure presentational.
 */

import { ViewToggle } from "@/components/shared/view-toggle";
import type { JobsArchiveSet } from "./jobs-list-config";

interface JobsToolbarProps {
  archiveSet: JobsArchiveSet;
  onArchiveSet: (v: JobsArchiveSet) => void;
  q: string;
  onQ: (v: string) => void;
  total: number;
  shown: number;
}

export function JobsToolbar({
  archiveSet,
  onArchiveSet,
  q,
  onQ,
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
      <span className="muted" style={{ marginLeft: "auto" }}>
        {shown} of {total}
      </span>
    </div>
  );
}
