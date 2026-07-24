import { describe, it, expect, vi } from "vitest";
import { HttpQboOauthGateway } from "./http-qbo-oauth-gateway";

const NOW = new Date("2026-07-24T12:00:00.000Z");
const now = () => NOW;

const config = {
  clientId: "client-abc",
  clientSecret: "secret-xyz",
  redirectUri: "https://app.example.com/api/qbo/callback",
};

const jsonResponse = (body: unknown, status = 200): Response =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

const goodBody = {
  access_token: "ACCESS-1",
  refresh_token: "REFRESH-1",
  expires_in: 3600,
  x_refresh_token_expires_in: 8_726_400, // ~101 days
};

describe("isConfigured", () => {
  it("is true with id, secret and redirect uri", () => {
    expect(new HttpQboOauthGateway(config, vi.fn(), now).isConfigured()).toBe(true);
  });

  it.each(["clientId", "clientSecret", "redirectUri"] as const)("is false without %s", (k) => {
    const g = new HttpQboOauthGateway({ ...config, [k]: undefined }, vi.fn(), now);
    expect(g.isConfigured()).toBe(false);
  });
});

describe("authorizeUrl", () => {
  const url = () => new URL(new HttpQboOauthGateway(config, vi.fn(), now).authorizeUrl("nonce-1"));

  it("points at Intuit's consent endpoint", () => {
    expect(url().origin + url().pathname).toBe("https://appcenter.intuit.com/connect/oauth2");
  });

  it("carries the state nonce through for CSRF verification", () => {
    expect(url().searchParams.get("state")).toBe("nonce-1");
  });

  it("requests only the accounting scope — no identity scopes", () => {
    const scope = url().searchParams.get("scope");
    expect(scope).toBe("com.intuit.quickbooks.accounting");
    expect(scope).not.toContain("openid");
  });

  it("sends client_id, response_type=code and the redirect uri", () => {
    const p = url().searchParams;
    expect(p.get("client_id")).toBe("client-abc");
    expect(p.get("response_type")).toBe("code");
    expect(p.get("redirect_uri")).toBe(config.redirectUri);
  });
});

describe("exchangeCode", () => {
  it("posts the authorization_code grant with HTTP Basic auth", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(goodBody));
    await new HttpQboOauthGateway(config, fetchMock, now).exchangeCode("the-code");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer");
    const headers = init.headers as Record<string, string>;
    const decoded = Buffer.from(
      (headers["Authorization"] as string).replace("Basic ", ""),
      "base64",
    ).toString("utf8");
    expect(decoded).toBe("client-abc:secret-xyz");

    const body = new URLSearchParams(init.body as string);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("the-code");
  });

  it("returns both tokens with absolute expiry instants derived from expires_in", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(goodBody));
    const res = await new HttpQboOauthGateway(config, fetchMock, now).exchangeCode("c");

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.accessToken).toBe("ACCESS-1");
    expect(res.value.refreshToken).toBe("REFRESH-1");
    expect(res.value.accessExpiresAt).toEqual(new Date(NOW.getTime() + 3600 * 1000));
    expect(res.value.refreshExpiresAt).toEqual(new Date(NOW.getTime() + 8_726_400 * 1000));
  });

  it("fails closed when unconfigured, without calling out", async () => {
    const fetchMock = vi.fn();
    const res = await new HttpQboOauthGateway(
      { ...config, clientId: undefined },
      fetchMock,
      now,
    ).exchangeCode("c");
    expect(res.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("refresh — Intuit rotates the refresh token", () => {
  it("returns the NEW refresh token, not the one we sent", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ ...goodBody, access_token: "ACCESS-2", refresh_token: "REFRESH-2" }),
    );
    const res = await new HttpQboOauthGateway(config, fetchMock, now).refresh("REFRESH-1");

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.refreshToken).toBe("REFRESH-2");
    expect(res.value.refreshToken).not.toBe("REFRESH-1");
  });

  it("posts the refresh_token grant", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(goodBody));
    await new HttpQboOauthGateway(config, fetchMock, now).refresh("REFRESH-1");
    const body = new URLSearchParams((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("REFRESH-1");
  });
});

describe("error handling", () => {
  it.each([400, 401])("maps HTTP %s to unauthorized — the tenant must reconnect", async (status) => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: "invalid_grant" }, status));
    const res = await new HttpQboOauthGateway(config, fetchMock, now).refresh("dead-token");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.kind).toBe("unauthorized");
  });

  it("does not retry a 400 — it fails identically every time and would trip the shared breaker", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, 400));
    await new HttpQboOauthGateway(config, fetchMock, now).refresh("dead");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("marks a 500 retryable", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, 500));
    const res = await new HttpQboOauthGateway(config, fetchMock, now).refresh("r");
    expect(res.ok).toBe(false);
    if (!res.ok && res.error.kind === "external_service") {
      expect(res.error.retryable).toBe(true);
    } else {
      expect.unreachable("expected an external_service error");
    }
  });

  it.each([
    ["missing access_token", { ...goodBody, access_token: undefined }],
    ["missing refresh_token", { ...goodBody, refresh_token: undefined }],
    ["non-numeric expires_in", { ...goodBody, expires_in: "soon" }],
    ["missing refresh expiry", { ...goodBody, x_refresh_token_expires_in: undefined }],
  ])("rejects a malformed response: %s", async (_label, body) => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(body));
    const res = await new HttpQboOauthGateway(config, fetchMock, now).exchangeCode("c");
    expect(res.ok).toBe(false);
  });

  it("never echoes a token value in the error message", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error_description: "token SUPERSECRET is bad" }, 400));
    const res = await new HttpQboOauthGateway(config, fetchMock, now).refresh("SUPERSECRET");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.message).not.toContain("SUPERSECRET");
  });

  it("surfaces a network throw as retryable rather than crashing", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    const res = await new HttpQboOauthGateway(config, fetchMock, now).exchangeCode("c");
    expect(res.ok).toBe(false);
  });
});

describe("revoke", () => {
  it("posts the token to the revoke endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, 200));
    const res = await new HttpQboOauthGateway(config, fetchMock, now).revoke("REFRESH-1");
    expect(res.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://developer.api.intuit.com/v2/oauth2/tokens/revoke");
    expect(JSON.parse(init.body as string)).toEqual({ token: "REFRESH-1" });
  });

  it("reports failure rather than throwing, so local disconnect can still proceed", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, 500));
    const res = await new HttpQboOauthGateway(config, fetchMock, now).revoke("r");
    expect(res.ok).toBe(false);
  });
});
