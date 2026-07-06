/**
 * lib/estimates.ts — shared quote derivations for the store Estimate.
 * ONE implementation of the money math (delegating to calcQuote) and expiry,
 * replacing the per-file copies that had already begun to drift.
 */

import { calcQuote } from "@/lib/prototype-sample";
import type { Estimate, Lead } from "@/lib/store/types";

/** Quote total — subtotal of non-optional lines − discount% + tax% (calcQuote). */
export function estTotal(e: Estimate): number {
  return calcQuote(e.lines, e.pricing).total;
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
