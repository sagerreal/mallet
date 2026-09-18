/**
 * Unit tests for the principal TTL cache (lib/auth/principal-ttl-cache.ts).
 * Uses a fake Date.now() clock to control time without any network or DB calls.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getCachedPrincipal,
  setCachedPrincipal,
  principalTtlMap,
  PRINCIPAL_TTL_MS,
} from "./principal-ttl-cache";
import type { Principal } from "@mallet/identity";

// ---------------------------------------------------------------------------
// Fake clock — replaces Date.now() for each test.
// ---------------------------------------------------------------------------
let fakeNow = 1_000_000; // arbitrary starting epoch ms

beforeEach(() => {
  fakeNow = 1_000_000;
  principalTtlMap.clear();
  vi.spyOn(Date, "now").mockImplementation(() => fakeNow);
});

afterEach(() => {
  vi.restoreAllMocks();
  principalTtlMap.clear();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const makePrincipal = (userId: string): Principal => ({
  userId: userId as Principal["userId"],
  orgId: "org-1" as Principal["orgId"],
  role: "owner",
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("getCachedPrincipal / setCachedPrincipal TTL cache", () => {
  it("returns null when the cache is empty", () => {
    expect(getCachedPrincipal("user-abc")).toBeNull();
  });

  it("returns the cached principal when within TTL", () => {
    const principal = makePrincipal("user-abc");
    setCachedPrincipal("user-abc", principal);

    // Advance time by less than TTL — should still be valid
    fakeNow += PRINCIPAL_TTL_MS - 1;
    expect(getCachedPrincipal("user-abc")).toEqual(principal);
  });

  it("returns null and evicts the entry when TTL has expired", () => {
    const principal = makePrincipal("user-abc");
    setCachedPrincipal("user-abc", principal);

    // Advance past TTL
    fakeNow += PRINCIPAL_TTL_MS + 1;
    expect(getCachedPrincipal("user-abc")).toBeNull();
    // Entry should be evicted from the map
    expect(principalTtlMap.has("user-abc")).toBe(false);
  });

  it("re-caches with a fresh expiry after a TTL miss", () => {
    const principal = makePrincipal("user-abc");
    setCachedPrincipal("user-abc", principal);

    // Expire the entry
    fakeNow += PRINCIPAL_TTL_MS + 1;
    expect(getCachedPrincipal("user-abc")).toBeNull();

    // Re-cache at the new time
    const resetAt = fakeNow;
    setCachedPrincipal("user-abc", principal);

    // Should be valid within the fresh TTL window
    fakeNow = resetAt + PRINCIPAL_TTL_MS - 1;
    expect(getCachedPrincipal("user-abc")).toEqual(principal);
  });

  it("different user ids do not collide", () => {
    const p1 = makePrincipal("user-1");
    const p2 = makePrincipal("user-2");
    setCachedPrincipal("user-1", p1);
    setCachedPrincipal("user-2", p2);

    expect(getCachedPrincipal("user-1")).toEqual(p1);
    expect(getCachedPrincipal("user-2")).toEqual(p2);
  });

  it("expiring one user id does not affect a separately-cached user", () => {
    const p1 = makePrincipal("user-1");
    setCachedPrincipal("user-1", p1);

    // Advance past TTL, then cache user-2 at the new (later) time
    fakeNow += PRINCIPAL_TTL_MS + 1;
    const p2 = makePrincipal("user-2");
    setCachedPrincipal("user-2", p2);

    expect(getCachedPrincipal("user-1")).toBeNull();
    expect(getCachedPrincipal("user-2")).toEqual(p2);
  });

  it("at exact TTL boundary (not yet expired): Date.now() === expiresAt is still valid", () => {
    const principal = makePrincipal("user-boundary");
    const setAt = fakeNow;
    setCachedPrincipal("user-boundary", principal);

    // expiresAt = setAt + TTL_MS; advance to that exact moment
    fakeNow = setAt + PRINCIPAL_TTL_MS;
    // condition: Date.now() > expiresAt → false (equal), so still valid
    expect(getCachedPrincipal("user-boundary")).toEqual(principal);
  });

  it("one ms past the TTL boundary is expired", () => {
    const principal = makePrincipal("user-boundary2");
    const setAt = fakeNow;
    setCachedPrincipal("user-boundary2", principal);

    fakeNow = setAt + PRINCIPAL_TTL_MS + 1;
    expect(getCachedPrincipal("user-boundary2")).toBeNull();
  });
});
