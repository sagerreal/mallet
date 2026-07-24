import type { Result, AppError } from "@mallet/shared/types";

/**
 * PLAINTEXT tokens as Intuit returns them. They cross this boundary unsealed and must be sealed
 * (platform/crypto/secret-box) before they touch a repository. Never log a value of this type.
 */
export interface QboTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly accessExpiresAt: Date;
  readonly refreshExpiresAt: Date;
}

/** The port. `infra/http-qbo-oauth-gateway` is the real one; tests substitute a fake. */
export interface QboOauthGateway {
  /** Is a client id/secret configured at all? False → the connect flow must fail closed. */
  isConfigured(): boolean;

  /** The Intuit consent URL to send the user to. `state` is the CSRF nonce we later verify. */
  authorizeUrl(state: string): string;

  /** Trade the ?code= from the callback for the first token pair. */
  exchangeCode(code: string, signal?: AbortSignal): Promise<Result<QboTokens, AppError>>;

  /**
   * Trade a refresh token for a fresh pair. Intuit ROTATES the refresh token here — the returned
   * `refreshToken` differs from the one passed in and the old value stops working, so the caller
   * must persist both halves of the result.
   */
  refresh(refreshToken: string, signal?: AbortSignal): Promise<Result<QboTokens, AppError>>;

  /** Best-effort revoke on disconnect. A failure here must not block local disconnection. */
  revoke(refreshToken: string, signal?: AbortSignal): Promise<Result<void, AppError>>;
}
