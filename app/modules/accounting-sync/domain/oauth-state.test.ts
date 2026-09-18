import { describe, it, expect } from "vitest";
import { signOauthState, verifyOauthState } from "./oauth-state";

const SECRET = "a-server-side-secret-value";
const OTHER_SECRET = "a-different-server-secret";
const NOW = new Date("2026-07-24T12:00:00.000Z");
const LATER = new Date(NOW.getTime() + 10 * 60_000);
const ORG = "22222222-2222-2222-2222-222222222222";

describe("signOauthState / verifyOauthState", () => {
  it("round-trips the org id", () => {
    const res = verifyOauthState(SECRET, signOauthState(SECRET, ORG, LATER), NOW);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.orgId).toBe(ORG);
  });

  it("recovers the expiry", () => {
    const res = verifyOauthState(SECRET, signOauthState(SECRET, ORG, LATER), NOW);
    if (res.ok) expect(res.value.expiresAt).toEqual(LATER);
  });

  it("mints a different value each time, so a state is unguessable not merely unforgeable", () => {
    expect(signOauthState(SECRET, ORG, LATER)).not.toBe(signOauthState(SECRET, ORG, LATER));
  });

  it("does not put the org id in the clear", () => {
    expect(signOauthState(SECRET, ORG, LATER)).not.toContain(ORG);
  });
});

describe("forgery and tampering", () => {
  it("rejects a state signed with a different secret", () => {
    const forged = signOauthState(OTHER_SECRET, ORG, LATER);
    expect(verifyOauthState(SECRET, forged, NOW).ok).toBe(false);
  });

  // The attack this exists to stop: swapping in a victim's org id to attach the attacker's
  // QuickBooks company to the victim's tenant.
  it("rejects a state whose org id has been swapped", () => {
    const mine = signOauthState(SECRET, "attacker-org", LATER);
    const parts = mine.split(".");
    parts[0] = Buffer.from(ORG, "utf8").toString("base64url");
    expect(verifyOauthState(SECRET, parts.join("."), NOW).ok).toBe(false);
  });

  it("rejects a state whose expiry has been extended", () => {
    const original = signOauthState(SECRET, ORG, LATER);
    const parts = original.split(".");
    parts[1] = String(LATER.getTime() + 60 * 60_000);
    expect(verifyOauthState(SECRET, parts.join("."), NOW).ok).toBe(false);
  });

  it("rejects a truncated signature without throwing", () => {
    const original = signOauthState(SECRET, ORG, LATER);
    const parts = original.split(".");
    parts[3] = (parts[3] as string).slice(0, 10);
    expect(verifyOauthState(SECRET, parts.join("."), NOW).ok).toBe(false);
  });

  it.each([["empty", ""], ["garbage", "nonsense"], ["too few parts", "a.b.c"], ["too many", "a.b.c.d.e"]])(
    "rejects a malformed state (%s)",
    (_label, bad) => {
      expect(verifyOauthState(SECRET, bad, NOW).ok).toBe(false);
    },
  );
});

describe("freshness", () => {
  it("rejects an expired state", () => {
    const expired = signOauthState(SECRET, ORG, new Date(NOW.getTime() - 1_000));
    const res = verifyOauthState(SECRET, expired, NOW);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.message).toMatch(/expired/);
  });

  it("rejects a state expiring exactly now (boundary is closed)", () => {
    expect(verifyOauthState(SECRET, signOauthState(SECRET, ORG, NOW), NOW).ok).toBe(false);
  });

  it("accepts a state one millisecond before expiry", () => {
    const state = signOauthState(SECRET, ORG, new Date(NOW.getTime() + 1));
    expect(verifyOauthState(SECRET, state, NOW).ok).toBe(true);
  });
});
