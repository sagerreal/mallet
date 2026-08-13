import type { OrgId, InvoiceId, Result, ExternalServiceError } from "@mallet/shared/types";

/**
 * Stripe Terminal (Tap to Pay) — the port the tap-payment use-cases talk to.
 *
 * DIRECT-CHARGE MODEL, deliberately: every Terminal resource here (connection token, location,
 * card_present PaymentIntent) is created ON the shop's connected account, because Stripe's
 * Terminal-with-Connect integration ties readers, locations and tokens to the account that owns
 * the charge — and the reader IS the technician's phone, which belongs to the shop, not to
 * Mallet. The money still lands exactly where a Checkout charge lands today (the shop's
 * connected account) and Mallet still skims the same 0.25% platform fee — as
 * `application_fee_amount` on the direct charge instead of on a destination charge.
 *
 * SEPARATE from PaymentLinkGateway on purpose: that port produces a hosted URL the customer
 * walks away with; this one produces credentials/intents a phone-reader consumes in person.
 * Folding them together would force every fake and every null-check to carry both worlds.
 */

export interface CreateConnectionTokenCmd {
  /** The shop's connected account (acct_...) the token is minted on. */
  readonly connectedAccountId: string;
  /**
   * Scope the token to the org's Terminal Location when one exists. Null = unscoped (valid for
   * any reader on the account) — the state before the first ensure-location call.
   */
  readonly locationId: string | null;
}

export interface TerminalConnectionToken {
  /** The one-time secret the Terminal SDK's token provider hands to the native reader. */
  readonly secret: string;
}

export interface CreateTerminalLocationCmd {
  readonly connectedAccountId: string;
  /** The shop's display name (orgs.name) — what the location is called in Stripe. */
  readonly displayName: string;
  /** The shop's business address as it writes it (free text), or null if never set. */
  readonly addressLine1: string | null;
  /** Stable per (org, account) so a retry returns the SAME location, never a duplicate. */
  readonly idempotencyKey: string;
}

export interface TerminalLocation {
  readonly locationId: string; // tml_...
}

export interface CreateTapIntentCmd {
  readonly orgId: OrgId;
  readonly invoiceId: InvoiceId;
  readonly connectedAccountId: string;
  readonly amountCents: number; // the invoice balance — never a caller-chosen amount
  readonly currency: string; // "usd"
  readonly description: string;
  /** Mallet's platform fee in integer cents (application_fee_amount on the direct charge). */
  readonly applicationFeeCents: number;
  readonly idempotencyKey: string;
}

export interface TapPaymentIntent {
  readonly paymentIntentId: string; // pi_...
  /** What the Terminal SDK's retrievePaymentIntent needs on the device. */
  readonly clientSecret: string;
}

/**
 * A PaymentIntent read back from the connected account for reconciliation. `metadata` carries
 * what WE stamped at create time ({orgId, invoiceId, kind:"tap"}); `amountReceivedCents` is what
 * Stripe actually settled — the only amount the recorder may trust.
 */
export interface RetrievedTapIntent {
  readonly paymentIntentId: string;
  readonly status: string; // Stripe's PaymentIntent status verbatim
  readonly amountReceivedCents: number;
  readonly metadata: Record<string, string>;
}

export interface TerminalGateway {
  createConnectionToken(
    cmd: CreateConnectionTokenCmd,
  ): Promise<Result<TerminalConnectionToken, ExternalServiceError>>;
  createLocation(
    cmd: CreateTerminalLocationCmd,
  ): Promise<Result<TerminalLocation, ExternalServiceError>>;
  createTapPaymentIntent(
    cmd: CreateTapIntentCmd,
  ): Promise<Result<TapPaymentIntent, ExternalServiceError>>;
  retrieveTapPaymentIntent(
    connectedAccountId: string,
    paymentIntentId: string,
  ): Promise<Result<RetrievedTapIntent, ExternalServiceError>>;
}
