import { call, CircuitBreaker, TimeoutError } from "@mallet/platform/resilience";
import { logger } from "@mallet/shared/observability";
import type { Result, AppError } from "@mallet/shared/types";
import { ok, err, externalService, unauthorized } from "@mallet/shared/types";
import type { SquareOauthGateway, SquareTokens } from "../domain/square-oauth-gateway";
import { SQUARE_SCOPES } from "../domain/square-oauth-gateway";

// The ONLY file that speaks Square's OAuth2 protocol. Everything else deals in SquareTokens.
//
// The HOST differs by environment and the credentials are not interchangeable — a sandbox
// application id is rejected against a live seller and vice versa. One switch picks both, so the
// two can never be half-mixed.
const HOSTS = {
  sandbox: "https://connect.squareupsandbox.com",
  production: "https://connect.squareup.com",
} as const;

export interface SquareOauthConfig {
  readonly applicationId: string | undefined;
  readonly applicationSecret: string | undefined;
  readonly redirectUri: string | undefined;
  readonly environment: "sandbox" | "production";
}

interface TokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_at?: unknown;
  merchant_id?: unknown;
}

const isNonEmptyString = (v: unknown): v is string => typeof v === "string" && v.length > 0;

/** Retry only transient failures — a 4xx fails identically every time and the breaker is shared. */
const isRetriableStatus = (status: number): boolean => status >= 500 || status === 429;

export class HttpSquareOauthGateway implements SquareOauthGateway {
  private readonly breaker = new CircuitBreaker("square-oauth", {
    failureThreshold: 5,
    resetMs: 30_000,
  });

  constructor(
    private readonly config: SquareOauthConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private get host(): string {
    return HOSTS[this.config.environment];
  }

  isConfigured(): boolean {
    return (
      isNonEmptyString(this.config.applicationId) &&
      isNonEmptyString(this.config.applicationSecret) &&
      isNonEmptyString(this.config.redirectUri)
    );
  }

  authorizeUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.config.applicationId ?? "",
      // Space-separated, per Square. The set is fixed in the domain — a seller who grants fewer
      // is recorded as such on the connection rather than silently assumed complete.
      scope: SQUARE_SCOPES.join(" "),
      session: "false",
      state,
    });
    // redirect_uri is deliberately NOT sent: Square uses the URL registered on the application,
    // and passing one that differs by a character is the most common cause of a failed connect.
    return `${this.host}/oauth2/authorize?${params.toString()}`;
  }

  /**
   * Shared token-endpoint POST. `what` only labels logs — it never carries a token value.
   *
   * THE SECRET GOES IN THE BODY, not an Authorization header. Verified against the live sandbox:
   * sending `Authorization: Client <secret>` (the shape Square's older docs show, and the shape
   * Intuit uses) is answered with
   *   400 MISSING_REQUIRED_PARAMETER "missing required parameter 'client_secret'"
   * With client_secret in the body and no auth header, a bogus code is answered with
   *   401 UNAUTHORIZED "Authorization code not found for app <id>"
   * — which is the credentials being ACCEPTED and the code correctly not resolving.
   */
  private async postToken(
    body: Record<string, string>,
    what: "exchange" | "refresh",
    signal?: AbortSignal,
  ): Promise<Result<SquareTokens, AppError>> {
    if (!this.isConfigured()) {
      return err(externalService("square", "Square is not configured", false));
    }

    try {
      const res = await call(
        (innerSignal) =>
          this.fetchImpl(`${this.host}/oauth2/token`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
              // Pinned: Square resolves behaviour by version, and an unpinned client silently
              // moves when they ship a new one.
              "Square-Version": "2025-01-23",
            },
            body: JSON.stringify({
              client_id: this.config.applicationId,
              client_secret: this.config.applicationSecret,
              ...body,
            }),
            signal: signal ?? innerSignal,
          }),
        {
          timeoutMs: 15_000,
          // Idempotent in the sense that matters: a retried token request either succeeds or
          // fails, it does not create a side effect we would be duplicating.
          idempotent: true,
          retries: 2,
          breaker: this.breaker,
          shouldRetry: (e) => e instanceof TimeoutError || e instanceof TypeError,
        },
      );

      if (!res.ok) {
        // 400/401 on a refresh means the token is dead — rotated past, revoked, or the seller
        // disconnected from their side. Surfaced as unauthorized so the caller can mark the
        // connection needs-reconnect rather than retrying forever. The body is NOT logged: it
        // can echo the token back.
        // On EXCHANGE a 401 means the authorization code did not resolve — expired, already
        // spent, or from a different application. On REFRESH it means the refresh token is dead
        // (rotated past, revoked, or the seller disconnected from Square's side). Either way the
        // shop must reconnect, and retrying cannot help. The body is NOT logged: it can echo the
        // token back.
        if (res.status === 400 || res.status === 401) {
          logger.warn({ what, status: res.status }, "square.oauth.rejected");
          return err(
            unauthorized(
              what === "exchange"
                ? "That Square authorization expired — start the connection again"
                : "Square rejected the saved credentials; reconnect required",
            ),
          );
        }
        logger.warn({ what, status: res.status }, "square.oauth.failed");
        return err(
          externalService("square", "couldn't reach Square — try again", isRetriableStatus(res.status)),
        );
      }

      const json = (await res.json()) as TokenResponse;
      if (
        !isNonEmptyString(json.access_token) ||
        !isNonEmptyString(json.refresh_token) ||
        !isNonEmptyString(json.merchant_id) ||
        !isNonEmptyString(json.expires_at)
      ) {
        // A 200 whose body is not what the contract promises is a protocol failure, not a token.
        // Storing a partial pair would produce a connection that cannot refresh.
        logger.error({ what }, "square.oauth.malformed_response");
        return err(externalService("square", "Square returned an unexpected response", false));
      }

      const accessExpiresAt = new Date(json.expires_at);
      if (Number.isNaN(accessExpiresAt.getTime())) {
        logger.error({ what }, "square.oauth.bad_expiry");
        return err(externalService("square", "Square returned an unexpected response", false));
      }

      return ok({
        accessToken: json.access_token,
        refreshToken: json.refresh_token,
        accessExpiresAt,
        merchantId: json.merchant_id,
      });
    } catch (e: unknown) {
      logger.error({ what, err: e instanceof Error ? e.message : String(e) }, "square.oauth.threw");
      return err(externalService("square", "couldn't reach Square — try again", true));
    }
  }

  async exchangeCode(code: string, signal?: AbortSignal): Promise<Result<SquareTokens, AppError>> {
    return this.postToken({ code, grant_type: "authorization_code" }, "exchange", signal);
  }

  async refresh(refreshToken: string, signal?: AbortSignal): Promise<Result<SquareTokens, AppError>> {
    return this.postToken({ refresh_token: refreshToken, grant_type: "refresh_token" }, "refresh", signal);
  }

  async revoke(accessToken: string, signal?: AbortSignal): Promise<Result<void, AppError>> {
    if (!this.isConfigured()) return err(externalService("square", "Square is not configured", false));
    try {
      const res = await this.fetchImpl(`${this.host}/oauth2/revoke`, {
        method: "POST",
        headers: {
          // Revoke is the ONE call that does use the header form — it authenticates the
          // application itself rather than exchanging a grant.
          Authorization: `Client ${this.config.applicationSecret}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          "Square-Version": "2025-01-23",
        },
        body: JSON.stringify({ client_id: this.config.applicationId, access_token: accessToken }),
        signal,
      });
      if (!res.ok) {
        logger.warn({ status: res.status }, "square.oauth.revoke_failed");
        return err(externalService("square", "Square could not revoke the token", true));
      }
      return ok(undefined);
    } catch (e: unknown) {
      logger.warn({ err: e instanceof Error ? e.message : String(e) }, "square.oauth.revoke_threw");
      return err(externalService("square", "couldn't reach Square — try again", true));
    }
  }
}
