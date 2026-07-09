/**
 * lib/estimates.ts — shared quote derivations for the store Estimate.
 * ONE implementation of the money math (delegating to calcQuote) and expiry,
 * replacing the per-file copies that had already begun to drift.
 */

import { calcQuote } from "@/lib/prototype-sample";
import type { Estimate, Lead } from "@/lib/store/types";

/**
 * Quote total in dollars — uses cachedTotal (set by the hydrator from the list
 * DTO) when full lines haven't been loaded yet; falls back to computing from
 * lines once the modal has fetched the full estimate record.
 */
export function estTotal(e: Estimate): number {
  return e.cachedTotal ?? calcQuote(e.lines, e.pricing).total;
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
