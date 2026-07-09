"use client";

/**
 * features/jobs/jobs-filters.tsx
 * The Jobs filter panel — Status (incl. Archived) + Crew, matching the Customers
 * filter panel. Pure presentational; state passed as props/callbacks.
 */

import type { Tech } from "@/lib/store/types";
import { JOB_STATUS_FILTERS } from "./jobs-list-config";

interface JobsFiltersProps {
  statusFilter: string;
  crewFilter: string;
  techs: Tech[];
  onStatus: (v: string) => void;
  onCrew: (v: string) => void;
  onClear: () => void;
  /** Status only narrows the active set — hidden in the archived view. */
  showStatus?: boolean;
}

export function JobsFilters({ statusFilter, crewFilter, techs, onStatus, onCrew, onClear, showStatus = true }: JobsFiltersProps) {
  return (
    <div className="fpanel">
      {showStatus && (
        <div className="field">
          <label htmlFor="jobs-filter-status">Status</label>
          <select id="jobs-filter-status" value={statusFilter} onChange={(e) => onStatus(e.target.value)}>
            <option value="">Any</option>
            {JOB_STATUS_FILTERS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="field">
        <label htmlFor="jobs-filter-crew">Crew</label>
        <select id="jobs-filter-crew" value={crewFilter} onChange={(e) => onCrew(e.target.value)}>
          <option value="">Any</option>
          {techs.map((t) => (
            <option key={t.id} value={String(t.id)}>
              {t.name}
            </option>
          ))}
        </select>
      </div>

      <button type="button" className="linklike" onClick={onClear} style={{ alignSelf: "flex-end" }}>
        Clear all
      </button>
    </div>
  );
}
