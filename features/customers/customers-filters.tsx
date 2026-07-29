/**
 * features/customers/customers-filters.tsx
 * Collapsible filter panel: Stage, Source, Clear all (§4.3).
 */

"use client";

import { SelectMenu } from "@/components/ui/select-menu";

interface FiltersProps {
  stageFilter: string;
  sourceFilter: string;
  stages: string[];
  sources: string[];
  onStage: (v: string) => void;
  onSource: (v: string) => void;
  onClear: () => void;
}

export function CustomersFilters({
  stageFilter,
  sourceFilter,
  stages,
  sources,
  onStage,
  onSource,
  onClear,
}: FiltersProps) {
  return (
    <div className="fpanel">
      <div className="field">
        <label htmlFor="cust-filter-stage">Stage</label>
        <SelectMenu
          value={stageFilter}
          onChange={onStage}
          options={[{ value: "", label: "Any" }, ...stages.map((s) => ({ value: s, label: s }))]}
          aria-label="Stage"
          compact
        />
      </div>

      <div className="field">
        <label htmlFor="cust-filter-source">Source</label>
        <SelectMenu
          value={sourceFilter}
          onChange={onSource}
          options={[{ value: "", label: "Any" }, ...sources.map((s) => ({ value: s, label: s }))]}
          aria-label="Source"
          compact
        />
      </div>

      <button
        type="button"
        className="linklike"
        onClick={onClear}
        style={{ alignSelf: "flex-end" }}
      >
        Clear all
      </button>
    </div>
  );
}
