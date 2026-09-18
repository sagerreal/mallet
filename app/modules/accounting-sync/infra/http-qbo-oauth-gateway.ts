import { call, CircuitBreaker, TimeoutError } from "@mallet/platform/resilience";
import { logger } from "@mallet/shared/observability";
import type { Result, AppError } from "@mallet/shared/types";
import { ok, err, externalService, unauthorized } from "@mallet/shared/types";
import type { QboOauthGateway, QboTokens } from "../domain/qbo-oauth-gateway";

// The ONLY file that speaks Intuit's OAuth2 protocol. Everything else deals in QboTokens.
//
// Endpoints are fixed across environments — only the ACCOUNTING API host differs by sandbox vs
// production (that lives in the API client, not here).
const AUTHORIZE_URL = "https://appcenter.intuit.com/connect/oauth2";
const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const REVOKE_URL = "https://developer.api.intuit.com/v2/oauth2/tokens/revoke";

// Accounting scope is all we need: TimeActivity, Employee, Item and Preferences all live there.
// openid/profile/email are deliberately NOT requested — we don't use Intuit for identity, and
// asking for less makes the consent screen less alarming to a shop owner.
const SCOPE = "com.intuit.quickbooks.accounting";

export interface IntuitOauthConfig {
  readonly clientId: string | undefined;
  readonly clientSecret: string | undefined;
  readonly redirectUri: string | undefined;
}

interface TokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  x_refresh_token_expires_in?: unknown;
}

const isPositiveNumber = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v > 0;
const isNonEmptyString = (v: unknown): v is string => typeof v === "string" && v.length > 0;

// Retry only transient failures. A 400 (bad/expired refresh token) fails identically every time,
// and the breaker is shared, so retrying deterministic errors could trip QBO for every tenant.
const isRetriableStatus = (status: number): boolean => status >= 500 || status === 429;

export class HttpQboOauthGateway implements QboOauthGateway {
  private readonly breaker = new CircuitBreaker("quickbooks-oauth", {
    failureThreshold: 5,
    resetMs: 30_000,
  });

  constructor(
    private readonly config: IntuitOauthConfig,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {}

  isConfigured(): boolean {
    return (
      isNonEmptyString(this.config.clientId) &&
      isNonEmptyString(this.config.clientSecret) &&
      isNonEmptyString(this.config.redirectUri)
    );
  }

  authorizeUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId ?? "",
      response_type: "code",
      scope: SCOPE,
      redirect_uri: this.config.redirectUri ?? "",
      state,
    });
    return `${AUTHORIZE_URL}?${params.toString()}`;
  }

  private basicAuth(): string {
    const pair = `${this.config.clientId}:${this.config.clientSecret}`;
    return `Basic ${Buffer.from(pair, "utf8").toString("base64")}`;
  }

  // Shared token-endpoint POST. `what` only labels logs/errors — it never carries a token value.
  private async postToken(
    body: URLSearchParams,
    what: "exchange" | "refresh",
    signal?: AbortSignal,
  ): Promise<Result<QboTokens, AppError>> {
    if (!this.isConfigured()) {
      return err(externalService("quickbooks", "QuickBooks is not configured", false));
    }

    try {
      const res = await call(
        (innerSignal) =>
          this.fetchImpl(TOKEN_URL, {
            method: "POST",
            headers: {
              Authorization: this.basicAuth(),
              "Content-Type": "application/x-www-form-urlencoded",
              Accept: "application/json",
            },
            body: body.toString(),
            signal: signal ?? innerSignal,
          }),
        {
          timeoutMs: 15_000,
          // A token exchange is idempotent in the sense that matters here: a retried request
          // either succeeds or fails, it does not create a side effect we'd be duplicating.
          idempotent: true,
          retries: 2,
          breaker: this.breaker,
          shouldRetry: (e) => e instanceof TimeoutError || e instanceof TypeError,
        },
      );

      if (!res.ok) {
        // 400 on a refresh means the token is dead (rotated past, revoked, or lapsed) — the tenant
        // must reconnect. Surfaced as unauthorized so callers can flag needs_reauth rather than
        // retrying forever. The response body is NOT included: it can echo the token back.
        if (res.status === 400 || res.status === 401) {
          logger.warn({ what, status: res.status }, "qbo.oauth.rejected");
          return err(unauthorized("QuickBooks rejected the credentials; reconnect required"));
        }
        logger.warn({ what, status: res.status }, "qbo.oauth.failed");
        return err(
          externalService(
            "quickbooks",
            `QuickBooks token ${what} failed (HTTP ${res.status})`,
            isRetriableStatus(res.status),
          ),
        );
      }

      const json = (await res.json()) as TokenResponse;
      return this.toTokens(json, what);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn({ what, err: message }, "qbo.oauth.error");
      return err(externalService("quickbooks", `QuickBooks token ${what} failed`, true));
    }
  }

  // Validate at the boundary — never trust the shape of an external response.
  private toTokens(json: TokenResponse, what: string): Result<QboTokens, AppError> {
    if (
      !isNonEmptyString(json.access_token) ||
      !isNonEmptyString(json.refresh_token) ||
      !isPositiveNumber(json.expires_in) ||
      !isPositiveNumber(json.x_refresh_token_expires_in)
    ) {
      logger.warn({ what }, "qbo.oauth.malformed_response");
      return err(externalService("quickbooks", "QuickBooks returned an unexpected token response", false));
    }
    const nowMs = this.now().getTime();
    return ok({
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      accessExpiresAt: new Date(nowMs + json.expires_in * 1000),
      refreshExpiresAt: new Date(nowMs + json.x_refresh_token_expires_in * 1000),
    });
  }

  exchangeCode(code: string, signal?: AbortSignal): Promise<Result<QboTokens, AppError>> {
    return this.postToken(
      new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: this.config.redirectUri ?? "",
      }),
      "exchange",
      signal,
    );
  }

  refresh(refreshToken: string, signal?: AbortSignal): Promise<Result<QboTokens, AppError>> {
    return this.postToken(
      new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
      "refresh",
      signal,
    );
  }

  // Best-effort. A shop clicking Disconnect must succeed locally even if Intuit is down, so every
  // failure here is logged and swallowed into ok() by the caller's policy — see disconnect-qbo.
  async revoke(refreshToken: string, signal?: AbortSignal): Promise<Result<void, AppError>> {
    if (!this.isConfigured()) {
      return err(externalService("quickbooks", "QuickBooks is not configured", false));
    }
    try {
      const res = await this.fetchImpl(REVOKE_URL, {
        method: "POST",
        headers: {
          Authorization: this.basicAuth(),
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ token: refreshToken }),
        ...(signal ? { signal } : {}),
      });
      if (!res.ok) {
        logger.warn({ status: res.status }, "qbo.oauth.revoke_failed");
        return err(
          externalService("quickbooks", `QuickBooks revoke failed (HTTP ${res.status})`, isRetriableStatus(res.status)),
        );
      }
      return ok(undefined);
    } catch (error) {
      logger.warn(
        { err: error instanceof Error ? error.message : String(error) },
        "qbo.oauth.revoke_error",
      );
      return err(externalService("quickbooks", "QuickBooks revoke failed", true));
    }
  }
}
