/**
 * modules/customers/domain/customer-tags.ts
 * Normalising a customer's tag set — the one place that decides what a tag list may contain.
 *
 * Tags are typed by hand into a picker that also seeds a shop-wide vocabulary, so the same label
 * arrives spelled several ways: with trailing spaces from a paste, twice from a double-click, and
 * as "google" after "Google". Left alone, the shop's own list slowly fills with near-duplicates
 * that each match a different half of the book — the failure the old free-text `source` column
 * actually had ("Nextdoor" and "Nextdoor / FB" both live on the live book today).
 *
 * DEDUPE IS CASE-INSENSITIVE, DISPLAY CASING IS THE CALLER'S. The first spelling wins, so a shop
 * that types "VIP" keeps "VIP" and a later "vip" collapses into it rather than renaming it.
 *
 * ORDER IS PRESERVED, not sorted. The picker shows the vocabulary in its own order; a customer's
 * tags read in the order somebody chose them, which is the order they think about them in.
 */

/** Longest single tag. Generous for a phrase ("Repeat customer"), short of a pasted sentence. */
export const MAX_TAG_LENGTH = 60;

/** Most tags one customer may carry. A label set, not a filing system. */
export const MAX_TAGS = 20;

/**
 * Trim, drop blanks, and collapse case-insensitive duplicates (first spelling wins).
 *
 * Total and pure — it never rejects. Length/count limits are invariants and belong to
 * `Lead.create`, which can return a ValidationError; a normaliser that threw would make every
 * read path (including hydrating a row already in the database) a try/catch.
 */
export function normalizeTags(input: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    const tag = raw.trim();
    if (tag.length === 0) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

/** True when every tag is within `MAX_TAG_LENGTH`. Assumes an already-normalised list. */
export function tagsWithinLength(tags: readonly string[]): boolean {
  return tags.every((t) => t.length <= MAX_TAG_LENGTH);
}
