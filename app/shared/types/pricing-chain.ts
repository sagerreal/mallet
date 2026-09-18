import type { Money } from "./money";
import { money } from "./money";

/**
 * THE money chain: subtotal → discount → net → tax → total → deposit.
 *
 * One implementation, because three documents have to agree on a single number and a customer
 * signed it. The quote derives the total the customer signs (Estimate.totalsFrom), the on-glass
 * job signature freezes the same total into its snapshot (buildJobSignature), and the invoice
 * rebuilds it from the job's lines weeks later (CreateInvoiceFromJobUseCase). Those three used to
 * be three copies of the same arithmetic; the invoice copy had already drifted once and overbilled
 * a live customer (lines $114.98, agreed $112.02, billed $124.47 — the discount step was missing).
 *
 * ORDER AND ROUNDING ARE THE CONTRACT, not an implementation detail:
 *
 *   discount = round(subtotal × discBps / 10000)
 *   net      = subtotal − discount
 *   tax      = round((taxableBase − round(taxableBase × discBps / 10000)) × taxBps / 10000)
 *   total    = net + tax
 *   deposit  = round(total × depBps / 10000)
 *
 * Every step rounds to whole cents so nothing accumulates float drift, and the discount comes off
 * the TAXABLE BASE at the same rate it comes off the bill — taxing the undiscounted base would
 * charge tax on money the customer never paid.
 *
 * `taxableBase` is a SECOND, DIFFERENT filter from the subtotal, not a subset shortcut. A
 * non-taxable line is still sold, still in the subtotal and still in the total; it simply does not
 * attract tax. On an all-taxable document taxableBase === subtotal and every figure is bit-for-bit
 * what it was before taxability existed.
 */

/** Basis points: 10000 bps = 100%. */
export const BPS_DENOMINATOR = 10_000;

/**
 * The cap on a SHARE-of-the-bill rate (discount, deposit) as a percentage, for the inputs that
 * collect one. The domain refuses discBps/depBps outside 0..10000 (Estimate.create), and a box
 * that can produce 150 hands the save path a payload the server will reject — so the same bound
 * is exported here and bound to the field. Tax is deliberately not covered: see PricingRates.
 */
export const MAX_SHARE_PCT = BPS_DENOMINATOR / 100;

/** Clamp a typed discount/deposit percentage into the range the domain accepts. */
export const clampSharePct = (pct: number): number =>
  Number.isFinite(pct) ? Math.min(MAX_SHARE_PCT, Math.max(0, pct)) : 0;

/** The three rates a document can carry. All integer basis points. */
export interface PricingRates {
  /** Discount, 0..10000 bps. */
  readonly discBps: number;
  /** Sales tax, >= 0 bps (some jurisdictions exceed 100% on specific goods; not capped). */
  readonly taxBps: number;
  /** Deposit asked up front, 0..10000 bps of the tax-inclusive total. */
  readonly depBps: number;
}

/** Every figure the chain produces, in integer cents. */
export interface PricedTotals {
  readonly subtotal: Money;
  readonly discount: Money;
  readonly net: Money;
  readonly tax: Money;
  readonly total: Money;
  readonly depositDue: Money;
}

const applyBps = (base: number, bps: number): Money => money(Math.round((base * bps) / BPS_DENOMINATOR));

/**
 * Run the chain.
 *
 * @param subtotal    Σ of every sold line's extended amount, in cents.
 * @param taxableBase Σ of the TAXABLE sold lines only, in cents. Pass `subtotal` when every line
 *                    is taxable — that is what it means, and it is what the field path sends.
 * @param rates       The document's three basis-point rates.
 */
export function deriveTotals(subtotal: Money, taxableBase: Money, rates: PricingRates): PricedTotals {
  const discount = applyBps(subtotal, rates.discBps);
  const net = money(subtotal - discount);
  const taxableDiscount = applyBps(taxableBase, rates.discBps);
  const tax = applyBps(taxableBase - taxableDiscount, rates.taxBps);
  const total = money(net + tax);
  return { subtotal, discount, net, tax, total, depositDue: applyBps(total, rates.depBps) };
}

/** No discount, no tax, no deposit — the shape a document with nothing set carries. */
export const ZERO_RATES: PricingRates = { discBps: 0, taxBps: 0, depBps: 0 };
