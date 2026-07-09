/**
 * features/customers/customers-columns.tsx
 * Collapsible column picker — checkboxes to show/hide columns (§4.3).
 */

"use client";

export const ALL_COL_DEFS: Record<string, { l: string }> = {
  name:    { l: "Name" },
  stage:   { l: "Stage" },
  value:   { l: "Value" },
  latest:  { l: "Latest" },
  phone:   { l: "Phone" },
  source:  { l: "Source" },
  age:     { l: "Days" },
  email:   { l: "Email" },
  address: { l: "Address" },
};

// Default view = "work the list": who · where in the pipeline · $ on the table ·
// what's latest · how to reach them. Source (marketing analytics) is opt-in.
export const DEFAULT_COLS = ["name", "stage", "value", "latest", "phone"] as const;

interface ColumnsProps {
  visible: string[];
  onToggle: (key: string) => void;
}

export function CustomersColumns({ visible, onToggle }: ColumnsProps) {
  return (
    <div className="fpanel" style={{ gap: 8 }}>
      {Object.entries(ALL_COL_DEFS).map(([k, def]) => (
        <label key={k} className="colchk">
          <input
            type="checkbox"
            checked={visible.includes(k)}
            onChange={() => onToggle(k)}
          />
          {def.l}
        </label>
      ))}
    </div>
  );
}
