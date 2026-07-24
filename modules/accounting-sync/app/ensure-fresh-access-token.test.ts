import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomBytes } from "node:crypto";
import { ok, err, unauthorized, externalService } from "@mallet/shared/types";
import { createSecretBox, type SecretBox } from "@mallet/platform/crypto/secret-box";
import { QboConnection, type QboConnectionProps } from "../domain/qbo-connection";
import type { QboConnectionRepository } from "../domain/qbo-connection-repository";
import type { QboOauthGateway, QboTokens } from "../domain/qbo-oauth-gateway";
import { EnsureFreshAccessToken } from "./ensure-fresh-access-token";

const T0 = new Date("2026-07-24T12:00:00.000Z");
const mins = (n: number) => n * 60_000;
const days = (n: number) => n * 24 * 60 * 60_000;
const ORG = "org-1";

const box: SecretBox = (() => {
  const res = createSecretBox(randomBytes(32).toString("base64"));
  if (!res.ok) throw new Error("fixture key rejected");
  return res.value;
})();

const connectionProps = (over: Partial<QboConnectionProps> = {}): QboConnectionProps => ({
  id: "conn-1",
  orgId: ORG,
  realmId: "913035",
  accessTokenSealed: box.seal("ACCESS-CURRENT"),
  refreshTokenSealed: box.seal("REFRESH-CURRENT"),
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

const connection = (over: Partial<QboConnectionProps> = {}): QboConnection => {
  const res = QboConnection.create(connectionProps(over));
  if (!res.ok) throw new Error(`fixture rejected: ${res.error.message}`);
  return res.value;
};

const freshTokens = (over: Partial<QboTokens> = {}): QboTokens => ({
  accessToken: "ACCESS-NEW",
  refreshToken: "REFRESH-NEW",
  accessExpiresAt: new Date(T0.getTime() + mins(60)),
  refreshExpiresAt: new Date(T0.getTime() + days(100)),
  ...over,
});

interface Harness {
  repo: QboConnectionRepository;
  gateway: QboOauthGateway;
  saved: QboConnection[];
  useCase: EnsureFreshAccessToken;
}

const harness = (opts: {
  stored?: QboConnection | null;
  refreshResult?: Awaited<ReturnType<QboOauthGateway["refresh"]>>;
  saveThrows?: boolean;
} = {}): Harness => {
  const saved: QboConnection[] = [];
  const stored = opts.stored === undefined ? connection() : opts.stored;

  const repo: QboConnectionRepository = {
    get: vi.fn().mockResolvedValue(stored),
    getForUpdate: vi.fn().mockResolvedValue(stored),
    save: vi.fn(async (c: QboConnection) => {
      if (opts.saveThrows) throw new Error("db down");
      saved.push(c);
    }),
  };

  const gateway: QboOauthGateway = {
    isConfigured: () => true,
    authorizeUrl: () => "https://appcenter.intuit.com/connect/oauth2",
    exchangeCode: vi.fn(),
    refresh: vi.fn().mockResolvedValue(opts.refreshResult ?? ok(freshTokens())),
    revoke: vi.fn(),
  };

  return {
    repo,
    gateway,
    saved,
    useCase: new EnsureFreshAccessToken(repo, gateway, box, { now: () => T0 }),
  };
};

describe("when no refresh is needed", () => {
  it("returns the stored access token without calling Intuit", async () => {
    const h = harness();
    const res = await h.useCase.exec(ORG);

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.accessToken).toBe("ACCESS-CURRENT");
    expect(h.gateway.refresh).not.toHaveBeenCalled();
  });

  it("returns the realm id alongside the token", async () => {
    const res = await harness().useCase.exec(ORG);
    if (res.ok) expect(res.value.realmId).toBe("913035");
  });

  it("takes the row lock, not a plain read", async () => {
    const h = harness();
    await h.useCase.exec(ORG);
    expect(h.repo.getForUpdate).toHaveBeenCalled();
    expect(h.repo.get).not.toHaveBeenCalled();
  });
});

describe("when the access token is stale", () => {
  const stale = () => connection({ accessExpiresAt: new Date(T0.getTime() - mins(1)) });

  it("refreshes and returns the NEW access token", async () => {
    const h = harness({ stored: stale() });
    const res = await h.useCase.exec(ORG);

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.accessToken).toBe("ACCESS-NEW");
  });

  it("persists the rotated REFRESH token — the lock-out bug", async () => {
    const h = harness({ stored: stale() });
    await h.useCase.exec(ORG);

    expect(h.saved).toHaveLength(1);
    const savedRefresh = box.open((h.saved[0] as QboConnection).props.refreshTokenSealed);
    expect(savedRefresh.ok).toBe(true);
    if (savedRefresh.ok) expect(savedRefresh.value).toBe("REFRESH-NEW");
  });

  it("persists the new access token too", async () => {
    const h = harness({ stored: stale() });
    await h.useCase.exec(ORG);
    const savedAccess = box.open((h.saved[0] as QboConnection).props.accessTokenSealed);
    if (savedAccess.ok) expect(savedAccess.value).toBe("ACCESS-NEW");
  });

  it("stores tokens SEALED, never in plaintext", async () => {
    const h = harness({ stored: stale() });
    await h.useCase.exec(ORG);
    const p = (h.saved[0] as QboConnection).props;
    expect(p.accessTokenSealed).not.toBe("ACCESS-NEW");
    expect(p.refreshTokenSealed).not.toBe("REFRESH-NEW");
    expect(p.accessTokenSealed.startsWith("v1.")).toBe(true);
  });

  it("sends the CURRENT refresh token to Intuit", async () => {
    const h = harness({ stored: stale() });
    await h.useCase.exec(ORG);
    expect(h.gateway.refresh).toHaveBeenCalledWith("REFRESH-CURRENT");
  });

  it("refreshes inside the skew buffer, before the token actually expires", async () => {
    const h = harness({
      stored: connection({ accessExpiresAt: new Date(T0.getTime() + mins(1)) }),
    });
    await h.useCase.exec(ORG);
    expect(h.gateway.refresh).toHaveBeenCalled();
  });
});

describe("failure handling", () => {
  it("reports not-connected when there is no row", async () => {
    const res = await harness({ stored: null }).useCase.exec(ORG);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.kind).toBe("not_found");
  });

  it("refuses a disconnected connection", async () => {
    const res = await harness({ stored: connection().disconnect(T0) }).useCase.exec(ORG);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.kind).toBe("unauthorized");
  });

  it("refuses once the refresh token has lapsed, without calling Intuit", async () => {
    const h = harness({
      stored: connection({ refreshExpiresAt: new Date(T0.getTime() - mins(1)) }),
    });
    const res = await h.useCase.exec(ORG);
    expect(res.ok).toBe(false);
    expect(h.gateway.refresh).not.toHaveBeenCalled();
  });

  it("marks needs_reauth when Intuit rejects the refresh token", async () => {
    const h = harness({
      stored: connection({ accessExpiresAt: new Date(T0.getTime() - mins(1)) }),
      refreshResult: err(unauthorized("rejected")),
    });
    const res = await h.useCase.exec(ORG);

    expect(res.ok).toBe(false);
    expect(h.saved).toHaveLength(1);
    expect((h.saved[0] as QboConnection).props.status).toBe("needs_reauth");
  });

  it("leaves the connection ALONE on a transient failure — the old token is still good", async () => {
    const h = harness({
      stored: connection({ accessExpiresAt: new Date(T0.getTime() - mins(1)) }),
      refreshResult: err(externalService("quickbooks", "503", true)),
    });
    const res = await h.useCase.exec(ORG);

    expect(res.ok).toBe(false);
    expect(h.saved).toHaveLength(0);
  });

  it("fails rather than returning a token it could not persist", async () => {
    const h = harness({
      stored: connection({ accessExpiresAt: new Date(T0.getTime() - mins(1)) }),
      saveThrows: true,
    });
    const res = await h.useCase.exec(ORG);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.kind).toBe("external_service");
  });

  it("flags needs_reauth when the stored ciphertext cannot be decrypted (key changed)", async () => {
    const h = harness({ stored: connection({ accessTokenSealed: "v1.bogus.bogus.bogus" }) });
    const res = await h.useCase.exec(ORG);

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.kind).toBe("unauthorized");
    expect((h.saved[0] as QboConnection).props.status).toBe("needs_reauth");
  });
});

describe("no secret ever reaches the logs", () => {
  let logged: string[];

  beforeEach(() => {
    logged = [];
    for (const stream of [process.stdout, process.stderr]) {
      vi.spyOn(stream, "write").mockImplementation((chunk: unknown) => {
        logged.push(String(chunk));
        return true;
      });
    }
  });

  it("logs the refresh without any token value", async () => {
    const h = harness({ stored: connection({ accessExpiresAt: new Date(T0.getTime() - mins(1)) }) });
    await h.useCase.exec(ORG);
    vi.restoreAllMocks();

    const all = logged.join("");
    for (const secret of ["ACCESS-NEW", "REFRESH-NEW", "ACCESS-CURRENT", "REFRESH-CURRENT"]) {
      expect(all).not.toContain(secret);
    }
  });
});
