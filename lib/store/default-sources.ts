/**
 * lib/store/default-sources.ts
 * The hardcoded default lead-source labels every org starts with.
 * Shared by the customers merge helper (display order: defaults first) and
 * the settings slice's addSource dedupe — persisting a label that matches a
 * default would create an invisible custom row (the merged picker already
 * shows the default).
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

/** Case-insensitive membership test against the default labels. */
export function isDefaultSourceLabel(label: string): boolean {
  const lower = label.toLowerCase();
  return DEFAULT_SOURCES.some((d) => d.toLowerCase() === lower);
}
