/**
 * features/customers/customers-filters.tsx
 * Collapsible filter panel: Stage, Source, Worklist, Clear all (§4.3).
 *
 * Every control here narrows in the DATABASE — the count beside the list takes the same narrowing,
 * so "12 of 12" means twelve in the whole book, not twelve on the loaded page.
 */

"use client";

import { SelectMenu } from "@/components/ui/select-menu";

interface FiltersProps {
  stageFilter: string;
  sourceFilter: string;
  scopeFilter: string;
  stages: string[];
  sources: string[];
  scopes: { value: string; label: string }[];
  onStage: (v: string) => void;
  onSource: (v: string) => void;
  onScope: (v: string) => void;
  onClear: () => void;
}

export function CustomersFilters({
  stageFilter,
  sourceFilter,
  scopeFilter,
  stages,
  sources,
  scopes,
  onStage,
  onSource,
  onScope,
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

      <div className="field">
        <label htmlFor="cust-filter-scope">Worklist</label>
        <SelectMenu
          value={scopeFilter}
          onChange={onScope}
          options={[{ value: "", label: "Everyone" }, ...scopes]}
          aria-label="Worklist"
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
