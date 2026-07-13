/**
 * Parses a money string (as it appears in a foreign CRM/spreadsheet export,
 * e.g. "$2,400.00") into integer cents — the DB/domain money convention.
 * Strips a leading `$`, thousands commas, and surrounding whitespace before
 * parsing the remainder as a decimal. Returns null for anything that isn't a
 * non-negative number: empty/whitespace-only, non-numeric, or negative (a
 * price or cost can never be negative).
 */
export function parseMoneyCents(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const cleaned = trimmed.replace(/^\$/, "").replace(/,/g, "").trim();
  if (!cleaned) return null;

  const dollars = Number(cleaned);
  if (Number.isNaN(dollars) || !Number.isFinite(dollars) || dollars < 0) return null;

  return Math.round(dollars * 100);
}
