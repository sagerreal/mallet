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
export function effectiveEstLines(e: Estimate): EstimateLine[] {
  if (!e.recommendedTier || e.acceptedTier) return e.lines;
  return e.lines.filter((l) => l.tier === e.recommendedTier);
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

import type { Invoice } from "@/lib/store/types";

/** Sum of recorded payments. */
export function invPaid(i: Invoice): number {
  return (i.payments ?? []).reduce((s, p) => s + (p.amt ?? 0), 0);
}

/** Balance still owed — total − deposit − payments, floored at 0. */
export function invDue(i: Invoice): number {
  return Math.max(0, (i.total ?? 0) - (i.depPaid ?? 0) - invPaid(i));
}
