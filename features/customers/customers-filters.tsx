/**
 * features/customers/customers-filters.tsx
 * Collapsible filter panel: Stage, Source, Clear all (§4.3).
 */

"use client";

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
        <select id="cust-filter-stage" value={stageFilter} onChange={(e) => onStage(e.target.value)}>
          <option value="">Any</option>
          {stages.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="cust-filter-source">Source</label>
        <select id="cust-filter-source" value={sourceFilter} onChange={(e) => onSource(e.target.value)}>
          <option value="">Any</option>
          {sources.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
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
