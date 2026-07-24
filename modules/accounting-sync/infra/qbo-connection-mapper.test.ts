import { describe, it, expect } from "vitest";
import { toDomain, toRow, type QboConnectionRow } from "./qbo-connection-mapper";

const T0 = new Date("2026-07-24T12:00:00.000Z");
const T1 = new Date("2026-07-24T13:00:00.000Z");
const T2 = new Date("2026-11-01T12:00:00.000Z");

const row = (over: Partial<QboConnectionRow> = {}): QboConnectionRow => ({
  id: "11111111-1111-1111-1111-111111111111",
  orgId: "22222222-2222-2222-2222-222222222222",
  realmId: "9130350000000000",
  accessTokenSealed: "v1.aXY=.dGFn.Y2lwaGVy",
  refreshTokenSealed: "v1.aXYy.dGFnMg==.Y2lwaGVyMg==",
  accessExpiresAt: T1,
  refreshExpiresAt: T2,
  status: "active",
  connectedByUserId: "33333333-3333-3333-3333-333333333333",
  lastSyncAt: null,
  createdAt: T0,
  updatedAt: T0,
  disconnectedAt: null,
  ...over,
});

describe("qbo-connection mapper", () => {
  it("round-trips every field unchanged", () => {
    const original = row({ lastSyncAt: T1 });
    expect(toRow(toDomain(original))).toEqual(original);
  });

  it("carries the sealed tokens through verbatim — no re-encoding", () => {
    const original = row();
    const out = toRow(toDomain(original));
    expect(out.accessTokenSealed).toBe(original.accessTokenSealed);
    expect(out.refreshTokenSealed).toBe(original.refreshTokenSealed);
  });

  it("round-trips a disconnected row (no tokens)", () => {
    const original = row({
      status: "disconnected",
      accessTokenSealed: "",
      refreshTokenSealed: "",
      disconnectedAt: T1,
    });
    expect(toRow(toDomain(original))).toEqual(original);
  });

  it("round-trips needs_reauth", () => {
    expect(toDomain(row({ status: "needs_reauth" })).props.status).toBe("needs_reauth");
  });

  it("preserves a null connectedByUserId (the user may have been removed)", () => {
    expect(toDomain(row({ connectedByUserId: null })).props.connectedByUserId).toBeNull();
  });

  it("throws on a row the domain rejects rather than returning something half-valid", () => {
    expect(() => toDomain(row({ status: "bogus" }))).toThrow(/corrupt qbo_connections row/);
  });

  it("names the org but never a token when a row is corrupt", () => {
    const bad = row({ status: "bogus" });
    try {
      toDomain(bad);
      expect.unreachable("should have thrown");
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain(bad.orgId);
      expect(msg).not.toContain(bad.accessTokenSealed);
      expect(msg).not.toContain(bad.refreshTokenSealed);
    }
  });
});
