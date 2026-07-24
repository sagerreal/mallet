import { describe, it, expect } from "vitest";
import { QboConnection, ACCESS_TOKEN_SKEW_MS, type QboConnectionProps } from "./qbo-connection";

const T0 = new Date("2026-07-24T12:00:00.000Z");
const mins = (n: number) => n * 60_000;
const days = (n: number) => n * 24 * 60 * 60_000;

const props = (over: Partial<QboConnectionProps> = {}): QboConnectionProps => ({
  id: "conn-1",
  orgId: "org-1",
  realmId: "9130350000000000",
  accessTokenSealed: "v1.sealed-access",
  refreshTokenSealed: "v1.sealed-refresh",
  accessExpiresAt: new Date(T0.getTime() + mins(60)),
  refreshExpiresAt: new Date(T0.getTime() + days(100)),
  status: "active",
  connectedByUserId: "user-1",
  lastSyncAt: null,
  createdAt: T0,
  updatedAt: T0,
  disconnectedAt: null,
  ...over,
});

const build = (over: Partial<QboConnectionProps> = {}): QboConnection => {
  const res = QboConnection.create(props(over));
  if (!res.ok) throw new Error(`fixture rejected: ${res.error.message}`);
  return res.value;
};

describe("QboConnection.create", () => {
  it("accepts a well-formed connection", () => {
    expect(QboConnection.create(props()).ok).toBe(true);
  });

  it.each(["orgId", "realmId", "accessTokenSealed", "refreshTokenSealed"] as const)(
    "rejects a missing %s",
    (field) => {
      const res = QboConnection.create(props({ [field]: "" }));
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.field).toBe(field);
    },
  );

  it("rejects an unknown status", () => {
    const res = QboConnection.create(props({ status: "bogus" as never }));
    expect(res.ok).toBe(false);
  });

  it("allows a disconnected connection to have no tokens", () => {
    const res = QboConnection.create(
      props({
        status: "disconnected",
        accessTokenSealed: "",
        refreshTokenSealed: "",
        disconnectedAt: T0,
      }),
    );
    expect(res.ok).toBe(true);
  });
});

describe("needsRefresh — the access token is only good for an hour", () => {
  it("is false well before expiry", () => {
    expect(build().needsRefresh(T0)).toBe(false);
  });

  it("is true once expired", () => {
    const c = build({ accessExpiresAt: new Date(T0.getTime() - mins(1)) });
    expect(c.needsRefresh(T0)).toBe(true);
  });

  it("is true inside the clock-skew buffer, so a request never rides an about-to-die token", () => {
    const c = build({ accessExpiresAt: new Date(T0.getTime() + ACCESS_TOKEN_SKEW_MS - 1_000) });
    expect(c.needsRefresh(T0)).toBe(true);
  });

  it("is false just outside the buffer", () => {
    const c = build({ accessExpiresAt: new Date(T0.getTime() + ACCESS_TOKEN_SKEW_MS + 1_000) });
    expect(c.needsRefresh(T0)).toBe(false);
  });
});

describe("isRefreshExpired — past this, only the shop can fix it", () => {
  it("is false while the refresh token is live", () => {
    expect(build().isRefreshExpired(T0)).toBe(false);
  });

  it("is true once the refresh token lapses", () => {
    const c = build({ refreshExpiresAt: new Date(T0.getTime() - mins(1)) });
    expect(c.isRefreshExpired(T0)).toBe(true);
  });
});

describe("withRefreshedTokens — Intuit rotates the refresh token every 24-26h", () => {
  it("stores BOTH new tokens (dropping the rotated refresh token locks the tenant out)", () => {
    const next = build().withRefreshedTokens(
      {
        accessTokenSealed: "v1.new-access",
        refreshTokenSealed: "v1.new-refresh",
        accessExpiresAt: new Date(T0.getTime() + mins(60)),
        refreshExpiresAt: new Date(T0.getTime() + days(100)),
      },
      new Date(T0.getTime() + mins(59)),
    );
    expect(next.props.accessTokenSealed).toBe("v1.new-access");
    expect(next.props.refreshTokenSealed).toBe("v1.new-refresh");
  });

  it("returns a new instance and leaves the original untouched", () => {
    const original = build();
    const next = original.withRefreshedTokens(
      {
        accessTokenSealed: "v1.new-access",
        refreshTokenSealed: "v1.new-refresh",
        accessExpiresAt: new Date(T0.getTime() + mins(60)),
        refreshExpiresAt: new Date(T0.getTime() + days(100)),
      },
      T0,
    );
    expect(next).not.toBe(original);
    expect(original.props.accessTokenSealed).toBe("v1.sealed-access");
  });

  it("clears needs_reauth — a successful refresh means the connection is healthy again", () => {
    const next = build({ status: "needs_reauth" }).withRefreshedTokens(
      {
        accessTokenSealed: "v1.a",
        refreshTokenSealed: "v1.r",
        accessExpiresAt: new Date(T0.getTime() + mins(60)),
        refreshExpiresAt: new Date(T0.getTime() + days(100)),
      },
      T0,
    );
    expect(next.props.status).toBe("active");
  });

  it("stamps updatedAt", () => {
    const at = new Date(T0.getTime() + mins(59));
    const next = build().withRefreshedTokens(
      {
        accessTokenSealed: "v1.a",
        refreshTokenSealed: "v1.r",
        accessExpiresAt: at,
        refreshExpiresAt: at,
      },
      at,
    );
    expect(next.props.updatedAt).toEqual(at);
  });
});

describe("state transitions", () => {
  it("markNeedsReauth keeps the realm but flags the connection", () => {
    const c = build().markNeedsReauth(T0);
    expect(c.props.status).toBe("needs_reauth");
    expect(c.props.realmId).toBe("9130350000000000");
  });

  it("disconnect clears both tokens so nothing can be replayed", () => {
    const c = build().disconnect(T0);
    expect(c.props.status).toBe("disconnected");
    expect(c.props.accessTokenSealed).toBe("");
    expect(c.props.refreshTokenSealed).toBe("");
    expect(c.props.disconnectedAt).toEqual(T0);
  });

  it("withLastSyncAt records a successful push without touching tokens", () => {
    const at = new Date(T0.getTime() + mins(5));
    const c = build().withLastSyncAt(at);
    expect(c.props.lastSyncAt).toEqual(at);
    expect(c.props.accessTokenSealed).toBe("v1.sealed-access");
  });
});

describe("isUsable — one predicate the callers agree on", () => {
  it("is true for an active, unexpired connection", () => {
    expect(build().isUsable(T0)).toBe(true);
  });

  it("is false when disconnected", () => {
    expect(build().disconnect(T0).isUsable(T0)).toBe(false);
  });

  it("is false when the refresh token has lapsed, even if status still says active", () => {
    const c = build({ refreshExpiresAt: new Date(T0.getTime() - mins(1)) });
    expect(c.isUsable(T0)).toBe(false);
  });

  it("is true when only the ACCESS token is stale — that is refreshable, not broken", () => {
    const c = build({ accessExpiresAt: new Date(T0.getTime() - mins(1)) });
    expect(c.isUsable(T0)).toBe(true);
  });
});
