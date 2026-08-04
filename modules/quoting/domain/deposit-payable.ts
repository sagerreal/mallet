/**
 * Stripe's minimum USD Checkout charge. Below it Stripe returns a deterministic 400, so a
 * sub-minimum deposit is refused before a request is sent that could only fail (a deterministic
 * failure also counts toward the shared circuit breaker).
 */
export const STRIPE_MIN_CHARGE_CENTS = 50;

export interface DepositPayableInput {
  /** Is the quote in a state that can take a deposit at all (accepted)? */
  readonly accepted: boolean;
  /** The derived deposit ask — depositDue(). */
  readonly depositDueCents: number;
  /** What has already been collected — the ledger total cached on the estimate. */
  readonly depositPaidCents: number;
  /** Can the shop take a card right now (Connect onboarded + charges enabled)? */
  readonly cardPaymentAvailable: boolean;
}

/**
 * How much deposit can be paid by card right now — 0 when none can.
 *
 * ONE predicate, deliberately, because it is asked in three places that must agree: the server
 * use-case that mints the checkout, the quote page deciding whether to render the button on a
 * return visit, and QuoteActions deciding whether to render it right after an in-session approval.
 * When those drifted, the third one lacked the card-minimum floor and offered a button whose only
 * possible outcome was the server refusing it — a dead button, which is the house rule this exists
 * to keep.
 *
 * Returning cents rather than a boolean is the point: the caller renders exactly the amount that
 * would be charged, so the button can never name a number the checkout would not take.
 */
export function payableDepositCents(input: DepositPayableInput): number {
  if (!input.accepted || !input.cardPaymentAvailable) return 0;
  const outstanding = input.depositDueCents - input.depositPaidCents;
  if (outstanding < STRIPE_MIN_CHARGE_CENTS) return 0;
  return outstanding;
}
