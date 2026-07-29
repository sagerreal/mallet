"use client";

/**
 * features/jobs/jobs-filters.tsx
 * The Jobs filter panel — Status (incl. Archived) + Crew, matching the Customers
 * filter panel. Pure presentational; state passed as props/callbacks.
 */

import type { Tech } from "@/lib/store/types";
import { JOB_STATUS_FILTERS } from "./jobs-list-config";
import { SelectMenu } from "@/components/ui/select-menu";

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
          <SelectMenu
            value={statusFilter}
            onChange={onStatus}
            options={[{ value: "", label: "Any" }, ...JOB_STATUS_FILTERS.map((s) => ({ value: s.value, label: s.label }))]}
            aria-label="Status"
            compact
          />
        </div>
      )}

      <div className="field">
        <label htmlFor="jobs-filter-crew">Crew</label>
        <SelectMenu
          value={crewFilter}
          onChange={onCrew}
          options={[{ value: "", label: "Any" }, ...techs.map((t) => ({ value: String(t.id), label: t.name }))]}
          aria-label="Crew"
          compact
        />
      </div>

      <button type="button" className="linklike" onClick={onClear} style={{ alignSelf: "flex-end" }}>
        Clear all
      </button>
    </div>
  );
}
