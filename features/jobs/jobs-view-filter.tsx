"use client";

import { JOB_VIEWS, JOB_VIEW_LABELS, type JobView } from "@/modules/jobs/infra/job-views";

/**
 * The one filter on the Jobs list, carrying a count per value.
 *
 * This is the piece worth copying from Jobber: their Status dropdown shows "Late (8)",
 * "Requires invoicing (6)", "Unscheduled (13)" — so you learn there are eight late jobs without
 * clicking anything. The counts come from the database, so "Needs a slot (13)" means thirteen
 * jobs in the business rather than thirteen of whatever the browser had loaded.
 *
 * ANCHORED AND IN-FLOW, per the house rule — this expands under the toolbar, it is not a popover.
 *
 * `archived` is deliberately absent from the options: it is reached through the Active/Archived
 * toggle in the toolbar, and offering the same state in two places invites them to disagree.
 */

export interface JobsViewFilterProps {
  readonly view: JobView | null;
  /** Per-view counts. Undefined while the query is in flight — the count is then simply omitted. */
  readonly counts: Partial<Record<JobView, number>> | undefined;
  readonly onView: (v: JobView | null) => void;
  readonly onClear: () => void;
  /** The archived set owns the view; the filter is inert rather than hidden, so it does not jump. */
  readonly disabled?: boolean;
}

const SELECTABLE = JOB_VIEWS.filter((v) => v !== "archived");

export function JobsViewFilter({ view, counts, onView, onClear, disabled = false }: JobsViewFilterProps) {
  return (
    <div className="jh-filters" role="group" aria-label="Filter jobs">
      <button
        type="button"
        className={`chip${view === null ? " on" : ""}`}
        aria-pressed={view === null}
        disabled={disabled}
        onClick={() => onView(null)}
      >
        All
      </button>

      {SELECTABLE.map((v) => {
        const n = counts?.[v];
        return (
          <button
            key={v}
            type="button"
            className={`chip${view === v ? " on" : ""}`}
            aria-pressed={view === v}
            disabled={disabled}
            onClick={() => onView(view === v ? null : v)}
          >
            {JOB_VIEW_LABELS[v]}
            {/* The count is omitted, not shown as 0, while it loads — a 0 that becomes 13 reads as
                data appearing from nowhere. */}
            {n === undefined ? null : <span className="chip-n"> ({n})</span>}
          </button>
        );
      })}

      {(view !== null || disabled) && (
        <button type="button" className="linklike" onClick={onClear}>
          Clear
        </button>
      )}
    </div>
  );
}
