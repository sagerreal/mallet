import { describe, it, expect, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { ok, err, externalService, unauthorized } from "@mallet/shared/types";
import { createSecretBox, type SecretBox } from "@mallet/platform/crypto/secret-box";
import { QboConnection, type QboConnectionProps } from "../domain/qbo-connection";
import type { QboConnectionRepository } from "../domain/qbo-connection-repository";
import type { QboOauthGateway, QboTokens } from "../domain/qbo-oauth-gateway";
import { CompleteQboConnect } from "./complete-qbo-connect";
import { DisconnectQbo } from "./disconnect-qbo";
import { GetQboStatus } from "./get-qbo-status";

const T0 = new Date("2026-07-24T12:00:00.000Z");
const mins = (n: number) => n * 60_000;
const days = (n: number) => n * 24 * 60 * 60_000;
const ORG = "org-1";
const clock = { now: () => T0 };
const ids = { newId: () => "generated-id" };

const box: SecretBox = (() => {
  const res = createSecretBox(randomBytes(32).toString("base64"));
  if (!res.ok) throw new Error("fixture key rejected");
  return res.value;
})();

const props = (over: Partial<QboConnectionProps> = {}): QboConnectionProps => ({
  id: "existing-id",
  orgId: ORG,
  realmId: "913035",
  accessTokenSealed: box.seal("ACCESS-OLD"),
  refreshTokenSealed: box.seal("REFRESH-OLD"),
  accessExpiresAt: new Date(T0.getTime() + mins(60)),
  refreshExpiresAt: new Date(T0.getTime() + days(100)),
  status: "active",
  connectedByUserId: "user-1",
  lastSyncAt: null,
  createdAt: new Date(T0.getTime() - days(30)),
  updatedAt: T0,
  disconnectedAt: null,
  ...over,
});

const connection = (over: Partial<QboConnectionProps> = {}): QboConnection => {
  const res = QboConnection.create(props(over));
  if (!res.ok) throw new Error(`fixture rejected: ${res.error.message}`);
  return res.value;
};

const tokens: QboTokens = {
  accessToken: "ACCESS-NEW",
  refreshToken: "REFRESH-NEW",
  accessExpiresAt: new Date(T0.getTime() + mins(60)),
  refreshExpiresAt: new Date(T0.getTime() + days(100)),
};

const deps = (opts: {
  stored?: QboConnection | null;
  exchange?: Awaited<ReturnType<QboOauthGateway["exchangeCode"]>>;
  revoke?: Awaited<ReturnType<QboOauthGateway["revoke"]>>;
  configured?: boolean;
} = {}) => {
  const stored = opts.stored === undefined ? null : opts.stored;
  const saved: QboConnection[] = [];
  const repo: QboConnectionRepository = {
    get: vi.fn().mockResolvedValue(stored),
    getForUpdate: vi.fn().mockResolvedValue(stored),
    save: vi.fn(async (c: QboConnection) => void saved.push(c)),
  };
  const gateway: QboOauthGateway = {
    isConfigured: () => opts.configured ?? true,
    authorizeUrl: () => "https://appcenter.intuit.com/connect/oauth2",
    exchangeCode: vi.fn().mockResolvedValue(opts.exchange ?? ok(tokens)),
    refresh: vi.fn(),
    revoke: vi.fn().mockResolvedValue(opts.revoke ?? ok(undefined)),
  };
  return { repo, gateway, saved };
};

describe("CompleteQboConnect", () => {
  const run = (d: ReturnType<typeof deps>, cmd = { code: "the-code", realmId: "913035", userId: "user-1" }) =>
    new CompleteQboConnect(d.repo, d.gateway, box, clock, ids).exec(cmd, ORG);

  it("stores an active connection with the realm and the user who connected", async () => {
    const d = deps();
    const res = await run(d);

    expect(res.ok).toBe(true);
    const saved = d.saved[0] as QboConnection;
    expect(saved.props.status).toBe("active");
    expect(saved.props.realmId).toBe("913035");
    expect(saved.props.connectedByUserId).toBe("user-1");
  });

  it("seals both tokens before storing them", async () => {
    const d = deps();
    await run(d);
    const p = (d.saved[0] as QboConnection).props;

    expect(p.accessTokenSealed).not.toBe("ACCESS-NEW");
    expect(p.refreshTokenSealed).not.toBe("REFRESH-NEW");
    const opened = box.open(p.refreshTokenSealed);
    if (opened.ok) expect(opened.value).toBe("REFRESH-NEW");
  });

  it.each([
    ["code", { code: "", realmId: "913035", userId: null }],
    ["realmId", { code: "c", realmId: "", userId: null }],
  ])("rejects a missing %s without calling Intuit", async (_label, cmd) => {
    const d = deps();
    const res = await run(d, cmd);
    expect(res.ok).toBe(false);
    expect(d.gateway.exchangeCode).not.toHaveBeenCalled();
  });

  it("surfaces an exchange failure and stores nothing", async () => {
    const d = deps({ exchange: err(externalService("quickbooks", "boom", true)) });
    const res = await run(d);
    expect(res.ok).toBe(false);
    expect(d.saved).toHaveLength(0);
  });

  describe("reconnecting an existing org", () => {
    it("keeps the original row id and createdAt", async () => {
      const existing = connection();
      const d = deps({ stored: existing });
      await run(d);
      const p = (d.saved[0] as QboConnection).props;

      expect(p.id).toBe("existing-id");
      expect(p.createdAt).toEqual(existing.props.createdAt);
    });

    it("preserves sync history — it is the same relationship, re-authorised", async () => {
      const lastSync = new Date(T0.getTime() - days(1));
      const d = deps({ stored: connection({ lastSyncAt: lastSync }) });
      await run(d);
      expect((d.saved[0] as QboConnection).props.lastSyncAt).toEqual(lastSync);
    });

    it("clears needs_reauth — reconnecting is exactly how a shop fixes that", async () => {
      const d = deps({ stored: connection({ status: "needs_reauth" }) });
      await run(d);
      expect((d.saved[0] as QboConnection).props.status).toBe("active");
    });

    it("clears disconnectedAt when reconnecting after a disconnect", async () => {
      const d = deps({ stored: connection().disconnect(T0) });
      await run(d);
      expect((d.saved[0] as QboConnection).props.disconnectedAt).toBeNull();
    });
  });
});

describe("DisconnectQbo", () => {
  const run = (d: ReturnType<typeof deps>) =>
    new DisconnectQbo(d.repo, d.gateway, box, clock).exec(ORG);

  it("revokes at Intuit then clears the local row", async () => {
    const d = deps({ stored: connection() });
    const res = await run(d);

    expect(res.ok).toBe(true);
    expect(d.gateway.revoke).toHaveBeenCalledWith("REFRESH-OLD");
    const p = (d.saved[0] as QboConnection).props;
    expect(p.status).toBe("disconnected");
    expect(p.refreshTokenSealed).toBe("");
  });

  it("still disconnects locally when the revoke call fails — Intuit being down is not a blocker", async () => {
    const d = deps({
      stored: connection(),
      revoke: err(externalService("quickbooks", "503", true)),
    });
    const res = await run(d);

    expect(res.ok).toBe(true);
    expect((d.saved[0] as QboConnection).props.status).toBe("disconnected");
  });

  it("still disconnects locally when the token cannot be unsealed", async () => {
    const d = deps({ stored: connection({ refreshTokenSealed: "v1.bad.bad.bad" }) });
    const res = await run(d);

    expect(res.ok).toBe(true);
    expect(d.gateway.revoke).not.toHaveBeenCalled();
    expect((d.saved[0] as QboConnection).props.status).toBe("disconnected");
  });

  it("reports not-connected when there is no row", async () => {
    const res = await run(deps({ stored: null }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.kind).toBe("not_found");
  });

  it("is idempotent — disconnecting twice succeeds without re-revoking", async () => {
    const d = deps({ stored: connection().disconnect(T0) });
    const res = await run(d);

    expect(res.ok).toBe(true);
    expect(d.gateway.revoke).not.toHaveBeenCalled();
    expect(d.saved).toHaveLength(0);
  });
});

describe("GetQboStatus", () => {
  const run = (d: ReturnType<typeof deps>) =>
    new GetQboStatus(d.repo, d.gateway, clock).exec();

  it("reports not_connected with no row", async () => {
    const s = await run(deps({ stored: null }));
    expect(s.state).toBe("not_connected");
    expect(s.realmId).toBeNull();
  });

  it("reports connected for a healthy connection", async () => {
    const s = await run(deps({ stored: connection() }));
    expect(s.state).toBe("connected");
    expect(s.realmId).toBe("913035");
  });

  it("reports needs_reauth when flagged", async () => {
    const s = await run(deps({ stored: connection({ status: "needs_reauth" }) }));
    expect(s.state).toBe("needs_reauth");
  });

  it("reports needs_reauth when the refresh token has silently lapsed", async () => {
    const s = await run(
      deps({ stored: connection({ refreshExpiresAt: new Date(T0.getTime() - mins(1)) }) }),
    );
    expect(s.state).toBe("needs_reauth");
    expect(s.expired).toBe(true);
  });

  it("reports disconnected", async () => {
    const s = await run(deps({ stored: connection().disconnect(T0) }));
    expect(s.state).toBe("disconnected");
  });

  it("flags configured=false when the server has no client credentials", async () => {
    const s = await run(deps({ stored: null, configured: false }));
    expect(s.configured).toBe(false);
  });

  it("exposes no token fields at all", async () => {
    const s = await run(deps({ stored: connection() }));
    expect(JSON.stringify(s)).not.toMatch(/token/i);
  });
});

describe("unauthorized exchange", () => {
  it("does not store a connection when Intuit rejects the code", async () => {
    const d = deps({ exchange: err(unauthorized("bad code")) });
    const res = await new CompleteQboConnect(d.repo, d.gateway, box, clock, ids).exec(
      { code: "stale", realmId: "913035", userId: null },
      ORG,
    );
    expect(res.ok).toBe(false);
    expect(d.saved).toHaveLength(0);
  });
});
