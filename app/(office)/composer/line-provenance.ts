/**
 * app/(office)/composer/line-provenance.ts
 *
 * Pure per-line provenance for the estimate line table (B3): where did THIS
 * price come from? Honest by construction — a line only earns the "pricebook"
 * caption when its description matches a real service in the shop's pricebook.
 *
 * We deliberately do NOT fabricate "won quote Q-1037" per-line attributions:
 * the drafter blends exemplar pricing into its reasoning but does not tag which
 * line came from which won quote, so claiming a specific quote per line would be
 * a guess. The staged run already surfaces the won-quote comparison honestly at
 * the run level; the line caption stays limited to what we can prove — an exact
 * pricebook match. Unmatched lines simply carry no caption (the AI's own
 * "Off-book:" prefix already signals a line that isn't in the book).
 */

/** Trim + collapse whitespace + casefold — the match key for a line vs a service name. */
export function normDesc(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

export interface ProvenanceService {
  readonly name: string;
}

/**
 * The provenance caption for one line description, or null when unmatched.
 * Currently only "pricebook" (exact normalized name match to a service).
 */
export function lineProvenance(
  description: string | null | undefined,
  services: readonly ProvenanceService[],
): "pricebook" | null {
  const key = normDesc(description ?? "");
  if (key.length === 0) return null;
  return services.some((s) => normDesc(s.name) === key) ? "pricebook" : null;
}
