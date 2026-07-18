// Mallet's platform fee on Connect card charges (Flow 1: shops charging their own customers).
// A flat 0.25% is skimmed as the Stripe application_fee_amount on each destination charge; the
// remainder settles to the shop. Held as a single basis-points constant so the rate is a one-line
// change and never a magic number scattered across the charge path.
export const PLATFORM_FEE_BPS = 25; // 0.25%

const BPS_DIVISOR = 10_000;

/**
 * Mallet's application fee, in integer cents, for a charge of `amountCents`.
 * Rounded to the nearest cent; floors at 0 for a zero/negative charge. Always far below the charge
 * amount (25 bps << 10000), so it never violates Stripe's application_fee_amount ≤ charge rule.
 */
export function platformFeeCents(amountCents: number): number {
  if (amountCents <= 0) return 0;
  return Math.round((amountCents * PLATFORM_FEE_BPS) / BPS_DIVISOR);
}
