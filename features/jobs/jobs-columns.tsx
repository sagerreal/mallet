"use client";

/**
 * features/jobs/jobs-columns.tsx
 * The Jobs column-visibility panel — toggle Status / When / Crew / Amount.
 * Customer/Job is fixed and not listed. Matches the Customers columns panel.
 */

import { JOB_COLS, JOB_COL_ORDER, type JobColKey } from "./jobs-list-config";

interface JobsColumnsProps {
  visible: JobColKey[];
  onToggle: (key: JobColKey) => void;
}

export function JobsColumns({ visible, onToggle }: JobsColumnsProps) {
  return (
    <div className="fpanel" style={{ gap: "var(--space-2)" }}>
      {JOB_COL_ORDER.map((k) => (
        <label key={k} className="colchk">
          <input type="checkbox" checked={visible.includes(k)} onChange={() => onToggle(k)} />
          {JOB_COLS[k].label}
        </label>
      ))}
    </div>
  );
}
