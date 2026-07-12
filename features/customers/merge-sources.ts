/**
 * features/customers/merge-sources.ts
 * Pure helper: merges the hardcoded default source labels with org-specific
 * custom sources from the DB. Defaults come first; custom sources that don't
 * match any default (case-insensitive) are appended.
 */

export const DEFAULT_SOURCES = [
  "Google",
  "Referral",
  "Nextdoor / FB",
  "Repeat customer",
  "Yard sign",
  "Angi",
  "Thumbtack",
  "Yelp",
] as const;

export type MergedSource = { label: string };

/**
 * Merge default labels with custom SourceItems from the store.
 * Order: defaults first, then custom entries that don't match any default.
 * Comparison is case-insensitive.
 */
export function mergeSources(
  defaults: readonly string[],
  custom: Array<{ id: string; label: string }>,
): MergedSource[] {
  const defaultLabels = defaults.map((d) => d.toLowerCase());
  const extras = custom.filter(
    (c) => !defaultLabels.includes(c.label.toLowerCase()),
  );
  return [
    ...defaults.map((label) => ({ label })),
    ...extras.map((c) => ({ label: c.label })),
  ];
}
