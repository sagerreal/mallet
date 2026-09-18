/**
 * lib/store/job-pricing.ts
 * The job's stored rates, run through the ONE money chain (deriveTotals) — so every surface that
 * derives a figure from `job.lines` + `job.pricing` lands on the number the invoice will bill.
 *
 * `Job.pricing` stores PERCENT (10 = 10%), mirroring Estimate.pricing; the chain takes basis
 * points; store lines are DOLLARS while the chain is integer cents. Those three conversions used
 * to be re-derived (or skipped — the tech work order summed raw lines and disagreed with the bill
 * by exactly the tax), so they live here once.
 *
 * Cents are extended PER LINE (`q × round(r × 100)`), matching the setLines wire payload and the
 * server's own line.amount() — summing dollars first and rounding once can differ by a cent.
 *
 * REDACTION IS NOT ZERO. A nulled rate (`r === null`) is the server withholding prices from this
 * device, and it reduces to 0 here. Callers must gate RENDERING on `pricesHidden` — a derived
 * "$0" shown to a technician on a genuinely priced job is the documented worst failure of these
 * surfaces. This module only does arithmetic; it cannot know what is safe to show.
 *
 * Taxability: store job lines carry no per-line flag (they are all taxable — the field builder
 * has no control for it, and the setLines wire sends none), so the taxable base IS the subtotal.
 * When per-line taxability reaches job lines, this is the one place that changes.
 */

import type { Job } from "./types";
import type { PricingRates, PricedTotals } from "@mallet/shared/types";
import { money, deriveTotals, ZERO_RATES, BPS_DENOMINATOR } from "@mallet/shared/types";

/** Percent → basis points, clamped to 0..100% and proof against NaN. */
const pctToBps = (pct: number): number =>
  Math.min(BPS_DENOMINATOR, Math.max(0, Math.round((Number.isFinite(pct) ? pct : 0) * 100)));

/** The job's stored percent pair as chain rates. Jobs hold no deposit rate — depBps is 0. */
export function jobPricingRates(job: Pick<Job, "pricing">): PricingRates {
  if (!job.pricing) return ZERO_RATES;
  return { discBps: pctToBps(job.pricing.disc), taxBps: pctToBps(job.pricing.tax), depBps: 0 };
}

/** True once either stored rate is set — drives whether a breakdown replaces the plain total. */
export function jobHasPricing(job: Pick<Job, "pricing">): boolean {
  const rates = jobPricingRates(job);
  return rates.discBps > 0 || rates.taxBps > 0;
}

/**
 * Σ of the job's lines in integer cents, extended per line like the wire. Redacted rates read 0.
 *
 * EXTEND FIRST, ROUND SECOND. The other order — round the rate to cents, then multiply by the
 * quantity — turns a fractional quantity into fractional cents, and `money()` throws on those by
 * contract. Nothing catches it on this path, so opening a job with 1.5 hours of labour at an odd
 * cent rate took the WHOLE SHEET to the error boundary (seen in production as
 * `Money must be integer cents, got 241495.5` — 1.5 x $1,609.97). Half-hours are ordinary in the
 * trades; this was reachable by typing a normal number into a normal field.
 *
 * This order is also what the server has always used — `invoice-line.ts` extends with
 * `money(Math.round(quantity * rate))` — and what the client's own price builder already did.
 * This function was the single place that disagreed, so it was the one that could disagree about
 * a total, too: rounding per-rate loses the half-cent the server keeps until the extension.
 */
function jobLineSubtotalCents(job: Pick<Job, "lines">): number {
  return (job.lines ?? []).reduce((sum, l) => sum + Math.round((l.q ?? 1) * (l.r ?? 0) * 100), 0);
}

/**
 * Every figure the bill will carry, in integer cents — the SAME derivation as
 * CreateInvoiceFromJobUseCase (all lines taxable, no deposit rate).
 */
export function jobPricedTotals(job: Pick<Job, "lines" | "pricing">): PricedTotals {
  const subtotal = money(Math.max(0, jobLineSubtotalCents(job)));
  return deriveTotals(subtotal, subtotal, jobPricingRates(job));
}
