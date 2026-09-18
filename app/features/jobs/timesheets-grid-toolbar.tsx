"use client";

/**
 * features/jobs/timesheets-grid-toolbar.tsx
 * Search + state chips above the crew grid.
 *
 * The chips carry counts because the count IS the reason to press one — "Needs review 3" tells an
 * approver how much work is left before they click anything, which is the question the old chip row
 * could not answer at all. Counts come from the rows already on screen, never a second query, so a
 * chip can never disagree with the grid beneath it.
 *
 * A chip whose count is zero stays visible and disabled rather than disappearing: a filter row that
 * changes shape as you work is harder to aim at than one that greys out.
 */

import type { TsGridFilter } from "./timesheet-grid-derive";
import type { TsGridMode } from "./timesheets-grid";

const CHIPS: readonly { key: TsGridFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "review", label: "Needs review" },
  { key: "issues", label: "Issues" },
  { key: "approved", label: "Approved" },
];

export interface TimesheetsGridToolbarProps {
  readonly filter: TsGridFilter;
  readonly counts: Record<TsGridFilter, number>;
  readonly query: string;
  readonly mode: TsGridMode;
  readonly onFilter: (f: TsGridFilter) => void;
  readonly onQuery: (q: string) => void;
  readonly onMode: (m: TsGridMode) => void;
  readonly onExport: () => void;
  /** Nothing on screen means nothing to export — the button says so rather than yielding a header. */
  readonly exportDisabled: boolean;
}

export function TimesheetsGridToolbar({
  filter,
  counts,
  query,
  mode,
  onFilter,
  onQuery,
  onMode,
  onExport,
  exportDisabled,
}: TimesheetsGridToolbarProps) {
  return (
    <div className="tsg-toolbar">
      <input
        type="search"
        className="field-compact tsg-search"
        placeholder="Search crew…"
        aria-label="Search crew"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
      />
      <div className="tsg-chips" role="group" aria-label="Filter timesheets">
        {CHIPS.map((c) => {
          const n = counts[c.key];
          // `all` is never disabled — with no crew at all the grid shows its own empty state, and a
          // disabled "All" would leave no way back from a filter that emptied the list.
          const off = n === 0 && c.key !== "all";
          return (
            <button
              key={c.key}
              type="button"
              className={filter === c.key ? "chip on" : "chip"}
              aria-pressed={filter === c.key}
              disabled={off}
              onClick={() => onFilter(c.key)}
            >
              {c.label} <span className="chip-n">{n}</span>
            </button>
          );
        })}
      </div>

      <span className="tsg-toolbar-gap" />

      {/* Two readings of one week, not two screens. Daily finds the day that looks wrong; summary
          is the shape payroll is keyed from. */}
      <div className="segctl" role="group" aria-label="Hours view">
        <button
          className={mode === "daily" ? "on" : ""}
          aria-pressed={mode === "daily"}
          onClick={() => onMode("daily")}
        >
          Daily
        </button>
        <button
          className={mode === "summary" ? "on" : ""}
          aria-pressed={mode === "summary"}
          onClick={() => onMode("summary")}
        >
          Summary
        </button>
      </div>

      <button className="btn sm" onClick={onExport} disabled={exportDisabled}>
        Export
      </button>
    </div>
  );
}
