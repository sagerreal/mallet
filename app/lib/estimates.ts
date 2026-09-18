/**
 * lib/estimates.ts — shared quote derivations for the store Estimate.
 * ONE implementation of the money math (delegating to calcQuote) and expiry,
 * replacing the per-file copies that had already begun to drift.
 */

import { calcQuote } from "@/lib/prototype-sample";
import type { Estimate, EstimateLine, QuoteTierKey, Lead } from "@/lib/store/types";

/**
 * The lines money and display derive from — mirrors the domain's effectiveLines:
 * a tiered estimate shows the RECOMMENDED tier pre-accept; after accept the
 * lines are already resolved (tags cleared server-side); single quotes show all.
 */
/**
 * The lines a CUSTOMER is shown, and the only ones that carry money.
 *
 * Components — the parts inside an assembly — are excluded. The parent line the customer reads
 * already carries their money in its rate, so showing them would read as extra charges beside a
 * total that does not contain them. Mirrors Estimate.contributesMoney in the domain; every
 * office surface that renders a quote's lines should go through here.
 */
export function quotedEstLines(lines: readonly EstimateLine[]): EstimateLine[] {
  return lines.filter((l) => l.parentIndex == null);
}

export function effectiveEstLines(e: Estimate): EstimateLine[] {
  const quoted = quotedEstLines(e.lines);
  if (!e.recommendedTier || e.acceptedTier) return quoted;
  return quoted.filter((l) => l.tier === e.recommendedTier);
}

/**
 * Quote total in dollars — uses cachedTotal (set by the hydrator from the list
 * DTO, already tier-aware server-side) when full lines haven't been loaded yet;
 * falls back to computing from the effective lines once the full record loads.
 */
export function estTotal(e: Estimate): number {
  return e.cachedTotal ?? calcQuote(effectiveEstLines(e), e.pricing).total;
}

// ---- Good/Better/Best display ------------------------------------------------

const TIER_FALLBACK_NAMES: Record<QuoteTierKey, string> = {
  good: "Good",
  better: "Better",
  best: "Best",
};

/** A tier's display name — custom tierNames entry, else Good/Better/Best. */
export function estTierName(e: Estimate, tier: QuoteTierKey): string {
  const custom = e.tierNames?.[tier]?.trim();
  return custom ? custom : TIER_FALLBACK_NAMES[tier];
}

/**
 * The one-line tier stamp for modals and pipeline cards, or null for single
 * quotes: "3 options · recommended Better" pre-accept, "Accepted: Best" after.
 */
export function gbbTierLine(e: Estimate): string | null {
  if (e.acceptedTier) return `Accepted: ${estTierName(e, e.acceptedTier)}`;
  if (e.recommendedTier) return `3 options · recommended ${estTierName(e, e.recommendedTier)}`;
  return null;
}

/** A sent quote past its validity window (default 14 days). */
export function isExpired(e: Estimate): boolean {
  return e.status === "sent" && e.age > (e.validDays ?? 14);
}

/** Σ estTotal over the given contacts' estimates in one status (company rollups). */
export function pipeSum(contacts: Lead[], estimates: Estimate[], status: string): number {
  const ids = new Set(contacts.map((l) => l.id));
  return estimates
    .filter((e) => e.status === status && ids.has(e.leadId))
    .reduce((s, e) => s + estTotal(e), 0);
}

// ---- invoice money (same module so home + Finance audit to the same penny) ---

/** Paid / still-owed: ONE definition, in lib/store/invoice-balance.ts. Re-exported here so home
 *  and Finance keep auditing to the same penny through their existing imports. */
export { invPaid, invDue } from "@/lib/store/invoice-balance";
