/**
 * features/customers/customers-columns.tsx
 * The customers table's column set and their relative widths.
 *
 * THERE IS NO PICKER ANY MORE. customers-view renders `DEFAULT_COLS` verbatim, so a definition
 * that is not in that list is unreachable — which is what the old `source` column had become.
 * Adding a column here without adding it to DEFAULT_COLS ships nothing.
 */

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
  // Key stays `stage` (the sort map and the row switch both use it); the LABEL changes,
  // because the cell renders the derived work group and "Stage" is the idea we retired.
  stage:   { l: "Where they are", w: 15 },
  value:   { l: "Value",   w: 9 },
  latest:  { l: "Latest",  w: 10 },
  phone:   { l: "Phone",   w: 14 },
  tags:    { l: "Tags",    w: 16 },
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

// Default view = "work the list": who · where their work has got to · WHERE THE JOB IS ·
// how to reach them.
//
// `latest` gave way to `address`. On a live book Latest read "Today" for every row the hydrator
// had touched, so it discriminated nothing; the address is the one fact that differs on every row
// and, in the trades, the thing people actually recall — "the house on Fort Clatsop" lands where a
// surname does not.
//
// `tags` joins them because the office asked for it on the list, and because with no picker left
// there is no other way to reach it. It sits last: it is the supplementary fact, and the three
// before it are how you find the row in the first place.
export const DEFAULT_COLS = ["name", "stage", "address", "phone", "tags"] as const;
