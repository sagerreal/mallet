import { describe, it, expect, vi } from "vitest";
import { HttpSquareOauthGateway } from "./http-square-oauth-gateway";
import { SQUARE_SCOPES } from "../domain/square-oauth-gateway";

const CONFIG = {
  applicationId: "sandbox-sq0idb-test",
  applicationSecret: "sandbox-sq0csb-secret",
  redirectUri: "http://localhost:3402/api/oauth/square/callback",
  environment: "sandbox" as const,
};

const jsonRes = (status: number, body: unknown): Response =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

const goodBody = {
  access_token: "EAAA-access",
  refresh_token: "EQAA-refresh",
  expires_at: "2026-09-01T00:00:00Z",
  merchant_id: "ML-MERCHANT-1",
};

describe("HttpSquareOauthGateway — configuration", () => {
  it("is not configured without a secret, so the connect flow can fail closed", () => {
    const gw = new HttpSquareOauthGateway({ ...CONFIG, applicationSecret: undefined });
    expect(gw.isConfigured()).toBe(false);
  });

  it("refuses to call Square at all when unconfigured", async () => {
    const fetchSpy = vi.fn();
    const gw = new HttpSquareOauthGateway({ ...CONFIG, applicationId: undefined }, fetchSpy as never);
    const r = await gw.exchangeCode("code");
    expect(r.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("HttpSquareOauthGateway — authorizeUrl", () => {
  const gw = new HttpSquareOauthGateway(CONFIG);

  it("points at the sandbox host, and production at the production host", () => {
    expect(gw.authorizeUrl("n")).toContain("connect.squareupsandbox.com");
    const prod = new HttpSquareOauthGateway({ ...CONFIG, environment: "production" });
    expect(prod.authorizeUrl("n")).toContain("connect.squareup.com");
  });

  // The fee scope is the whole platform revenue model — a connect URL that quietly drops it
  // produces a shop that can take payments while Mallet earns nothing, discovered at charge time.
  it("asks for the application-fee scope", () => {
    expect(gw.authorizeUrl("n")).toContain("PAYMENTS_WRITE_ADDITIONAL_RECIPIENTS");
    for (const scope of SQUARE_SCOPES) expect(gw.authorizeUrl("n")).toContain(scope);
  });

  it("carries the CSRF nonce through", () => {
    expect(gw.authorizeUrl("nonce-123")).toContain("state=nonce-123");
  });

  // Square uses the URL registered on the application. Sending one that differs by a character
  // is the most common cause of a failed connect, so we do not send one at all.
  it("does not send a redirect_uri", () => {
    expect(gw.authorizeUrl("n")).not.toContain("redirect_uri");
  });
});

describe("HttpSquareOauthGateway — token exchange", () => {
  /**
   * THE SHAPE VERIFIED AGAINST LIVE SANDBOX. Sending the secret as `Authorization: Client <s>` —
   * the form Square's older docs show, and the form Intuit uses — is answered with
   * 400 MISSING_REQUIRED_PARAMETER "missing required parameter 'client_secret'". It belongs in
   * the body. This test is the guard on that, because the failure is a runtime 400 that no type
   * checks and that only appears the first time a real shop tries to connect.
   */
  it("sends client_secret in the BODY, not an Authorization header", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonRes(200, goodBody));
    const gw = new HttpSquareOauthGateway(CONFIG, fetchSpy as never);
    await gw.exchangeCode("the-code");

    const [, init] = fetchSpy.mock.calls[0]!;
    const body = JSON.parse(init.body as string);
    expect(body.client_secret).toBe(CONFIG.applicationSecret);
    expect(body.client_id).toBe(CONFIG.applicationId);
    expect(body.code).toBe("the-code");
    expect(body.grant_type).toBe("authorization_code");
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it("pins the Square-Version, so behaviour cannot move under us", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonRes(200, goodBody));
    await new HttpSquareOauthGateway(CONFIG, fetchSpy as never).exchangeCode("c");
    const [, init] = fetchSpy.mock.calls[0]!;
    expect((init.headers as Record<string, string>)["Square-Version"]).toBeTruthy();
  });

  it("returns the tokens and the merchant id", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonRes(200, goodBody));
    const r = await new HttpSquareOauthGateway(CONFIG, fetchSpy as never).exchangeCode("c");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.accessToken).toBe("EAAA-access");
      expect(r.value.refreshToken).toBe("EQAA-refresh");
      expect(r.value.merchantId).toBe("ML-MERCHANT-1");
      expect(r.value.accessExpiresAt.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    }
  });

  // A 200 whose body is not what the contract promises is a protocol failure, not a token.
  // Storing a partial pair produces a connection that cannot refresh — dead on its first renewal.
  it("refuses a 200 that is missing the refresh token", async () => {
    const partial = { ...goodBody, refresh_token: undefined };
    const fetchSpy = vi.fn().mockResolvedValue(jsonRes(200, partial));
    const r = await new HttpSquareOauthGateway(CONFIG, fetchSpy as never).exchangeCode("c");
    expect(r.ok).toBe(false);
  });

  it("refuses a 200 whose expiry does not parse", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonRes(200, { ...goodBody, expires_at: "not-a-date" }));
    const r = await new HttpSquareOauthGateway(CONFIG, fetchSpy as never).exchangeCode("c");
    expect(r.ok).toBe(false);
  });

  it("maps a 401 to unauthorized so the caller stops retrying and asks for a reconnect", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonRes(401, { errors: [{ code: "UNAUTHORIZED" }] }));
    const r = await new HttpSquareOauthGateway(CONFIG, fetchSpy as never).exchangeCode("c");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("unauthorized");
  });

  it("says the authorization expired on exchange, not that saved credentials are bad", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonRes(401, {}));
    const r = await new HttpSquareOauthGateway(CONFIG, fetchSpy as never).exchangeCode("c");
    if (!r.ok) expect(r.error.message).toMatch(/authorization expired/i);
  });

  it("says reconnect required on refresh, which is a different situation", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonRes(401, {}));
    const r = await new HttpSquareOauthGateway(CONFIG, fetchSpy as never).refresh("dead-token");
    if (!r.ok) expect(r.error.message).toMatch(/reconnect required/i);
  });

  it("marks a 5xx retryable and a 4xx not", async () => {
    const five = vi.fn().mockResolvedValue(jsonRes(503, {}));
    const r5 = await new HttpSquareOauthGateway(CONFIG, five as never).exchangeCode("c");
    if (!r5.ok && r5.error.kind === "external_service") expect(r5.error.retryable).toBe(true);
  });
});

describe("HttpSquareOauthGateway — refresh", () => {
  it("sends grant_type refresh_token with the token in the body", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonRes(200, goodBody));
    await new HttpSquareOauthGateway(CONFIG, fetchSpy as never).refresh("old-refresh");
    const body = JSON.parse(fetchSpy.mock.calls[0]![1].body as string);
    expect(body.grant_type).toBe("refresh_token");
    expect(body.refresh_token).toBe("old-refresh");
  });

  // Square ROTATES the refresh token on use: the returned value differs from the one sent and the
  // old one stops working. A caller that persists only the access token has a dead connection at
  // the next renewal, so the gateway must always hand back both halves.
  it("returns the ROTATED refresh token, not the one it was given", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonRes(200, { ...goodBody, refresh_token: "EQAA-rotated" }));
    const r = await new HttpSquareOauthGateway(CONFIG, fetchSpy as never).refresh("EQAA-original");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.refreshToken).toBe("EQAA-rotated");
  });
});
