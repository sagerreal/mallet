/**
 * features/customers/customers-columns.tsx
 * Collapsible column picker — checkboxes to show/hide columns (§4.3).
 */

"use client";

/**
 * `w` is a relative width WEIGHT, not a pixel size.
 *
 * The table is `width:100%` with automatic layout, so on a wide screen the browser spreads the
 * surplus across the columns in near-equal shares regardless of what is in them. With four short
 * columns that put a stage pill and a phone number in the middle of huge empty cells, and left a
 * dead gutter on the right. Weights hand that surplus to the columns whose content can use it —
 * a name or an address — and hold the fixed-shape ones (a pill, a date, a day count) narrow.
 */
export const ALL_COL_DEFS: Record<string, { l: string; w: number }> = {
  name:    { l: "Name",    w: 22 },
  stage:   { l: "Stage",   w: 13 },
  value:   { l: "Value",   w: 9 },
  latest:  { l: "Latest",  w: 10 },
  phone:   { l: "Phone",   w: 14 },
  source:  { l: "Source",  w: 12 },
  age:     { l: "Days",    w: 7 },
  email:   { l: "Email",   w: 20 },
  address: { l: "Address", w: 24 },
};

/**
 * Column weights → CSS percentages that always sum to 100, whatever subset is visible.
 * Normalising matters: the picker allows any combination, so raw weights would under- or
 * over-fill the table depending on how many columns happen to be on.
 */
export function colWidths(visible: readonly string[]): string[] {
  const weights = visible.map((k) => ALL_COL_DEFS[k]?.w ?? 10);
  const total = weights.reduce((sum, w) => sum + w, 0);
  if (total <= 0) return visible.map(() => `${(100 / Math.max(1, visible.length)).toFixed(4)}%`);
  return weights.map((w) => `${((w / total) * 100).toFixed(4)}%`);
}

// Default view = "work the list": who · where in the pipeline · $ on the table ·
// what's latest · how to reach them. Source (marketing analytics) is opt-in.
export const DEFAULT_COLS = ["name", "stage", "latest", "phone"] as const;

interface ColumnsProps {
  visible: string[];
  onToggle: (key: string) => void;
}

export function CustomersColumns({ visible, onToggle }: ColumnsProps) {
  return (
    <div className="fpanel" style={{ gap: "var(--space-2)" }}>
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
