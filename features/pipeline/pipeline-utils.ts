/**
 * features/pipeline/pipeline-utils.ts
 * Shared board derivations (used by both the card and the column so the two
 * can never drift).
 */

import { estTotal } from "@/lib/estimates";
import type { Lead, Estimate } from "@/lib/store/types";

/** A lead's board value — its first non-draft quote total, else the stated value. */
export function leadVal(lead: Lead, estimates: Estimate[]): number {
  const e = estimates.find((e) => e.leadId === lead.id && e.status !== "draft");
  return e ? estTotal(e) : (lead.value ?? 0);
}

/** Scoped on site but never quoted — the office still owes this lead a quote. */
export function isScopedNeedsQuote(lead: Lead, estimates: Estimate[]): boolean {
  if (lead.stage === "Won" || lead.stage === "Lost") return false;
  const visited = (lead.evisits ?? []).some((v) => v.scopeNotes);
  return visited && !estimates.some((e) => e.leadId === lead.id);
}
