import type { Result, AppError } from "@mallet/shared/types";

/**
 * PLAINTEXT tokens as Square returns them. They cross this boundary unsealed and MUST be sealed
 * (platform/crypto/secret-box) before they touch a repository. Never log a value of this type —
 * an access token here authorises charges against a real merchant account.
 */
export interface SquareTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly accessExpiresAt: Date;
  /** Square's merchant id for the seller who just authorised us. Identifies the connection. */
  readonly merchantId: string;
}

/**
 * The scopes Mallet asks a seller for.
 *
 * PAYMENTS_WRITE_ADDITIONAL_RECIPIENTS is the one that carries the platform fee — Square's own
 * words: "by granting these permissions, Square sellers indicate that you're allowed to take a
 * portion of a payment as an application fee". There is no separate approval process; the seller's
 * consent IS the permission, which is why it must be requested here and recorded on the connection.
 *
 * MERCHANT_PROFILE_READ is what lets us name the shop and list its locations — a payment is taken
 * against a location, so a connection without it cannot actually charge.
 */
export const SQUARE_SCOPES: readonly string[] = [
  "MERCHANT_PROFILE_READ",
  "PAYMENTS_READ",
  "PAYMENTS_WRITE",
  "PAYMENTS_WRITE_ADDITIONAL_RECIPIENTS",
  "ORDERS_READ",
  "ORDERS_WRITE",
  "CUSTOMERS_READ",
  "CUSTOMERS_WRITE",
];

/** The port. `infra/http-square-oauth-gateway` is the real one; tests substitute a fake. */
export interface SquareOauthGateway {
  /** Is an application id/secret configured at all? False → the connect flow must fail closed. */
  isConfigured(): boolean;

  /** The Square consent URL to send the shop owner to. `state` is the CSRF nonce we verify later. */
  authorizeUrl(state: string): string;

  /** Trade the ?code= from the callback for the first token pair. */
  exchangeCode(code: string, signal?: AbortSignal): Promise<Result<SquareTokens, AppError>>;

  /**
   * Trade a refresh token for a fresh pair. Square ROTATES the refresh token on use — the returned
   * value differs from the one passed in and the old one stops working, so the caller must persist
   * both halves of the result or the connection is dead at the next refresh.
   */
  refresh(refreshToken: string, signal?: AbortSignal): Promise<Result<SquareTokens, AppError>>;

  /** Best-effort revoke on disconnect. A failure here must not block local disconnection. */
  revoke(accessToken: string, signal?: AbortSignal): Promise<Result<void, AppError>>;
}
