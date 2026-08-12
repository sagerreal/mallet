import type { AppError, Result } from "@mallet/shared/types";

export interface ChargeSavedCardCmd {
  readonly orgId: string;
  readonly invoiceId: string;
  /** The FULL balance due — computed server-side, never a caller figure. */
  readonly amountCents: number;
  readonly currency: string; // "usd"
  readonly description: string;
  /** The saved Stripe pointers, from the org's own payment_profiles row. */
  readonly customerId: string;
  readonly paymentMethodId: string;
  /** Destination-charge posture, identical to the Checkout path (on_behalf_of + transfer). */
  readonly connectedAccountId: string;
  readonly applicationFeeCents: number;
  /**
   * Namespaced per attempt by the router (client key + user + invoice). Deliberately NOT
   * derived from the balance alone: Stripe caches the RESPONSE under the key for 24h, so a
   * deterministic key would replay a cached DECLINE forever — a customer whose bank cleared
   * an hour later could never be charged again. A retry of the SAME attempt (same key) after
   * a dropped connection safely returns the same succeeded intent, which the recorder dedupes.
   */
  readonly idempotencyKey: string;
}

export interface ChargedCard {
  readonly paymentIntentId: string;
  /** What Stripe actually settled — the figure the ledger records, never our own arithmetic. */
  readonly amountReceivedCents: number;
}

/**
 * Charges a card the customer saved earlier, off-session — the "paid before they left" play.
 *
 * The error contract carries the REAL refusal: a decline maps to `conflict` with Stripe's own
 * user-facing sentence ("Your card has insufficient funds."), because the person at the door
 * must be able to read it to the customer and pick another method; infrastructure failures map
 * to `external_service` with the usual generic copy. The two must never be conflated — a
 * decline is not an outage, and retrying it accomplishes nothing.
 */
export interface CardChargeGateway {
  chargeSavedCard(cmd: ChargeSavedCardCmd): Promise<Result<ChargedCard, AppError>>;
}
