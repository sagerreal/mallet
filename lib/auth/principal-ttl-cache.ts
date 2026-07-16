import type { Principal } from "@mallet/identity";

// ---------------------------------------------------------------------------
// Module-level TTL principal cache (best-effort across serverless warm calls)
// ---------------------------------------------------------------------------
// Keyed by auth user id. Serverless instances are ephemeral, so this is a
// warm-instance win — not a guaranteed cache. Invalidation nuance: org role
// or field-crew changes take ≤60 s to propagate across warm instances.
// Acceptable for a field-service app where principals change rarely.
export const PRINCIPAL_TTL_MS = 60_000; // 60 s

interface CachedPrincipal {
  readonly principal: Principal;
  readonly expiresAt: number; // Date.now()-based epoch ms
}

// Exported for testing: tests can clear this map between runs.
export const principalTtlMap = new Map<string, CachedPrincipal>();

/** Returns the cached Principal if present and not expired, else null. Evicts stale entries. */
export function getCachedPrincipal(authUserId: string): Principal | null {
  const entry = principalTtlMap.get(authUserId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    principalTtlMap.delete(authUserId);
    return null;
  }
  return entry.principal;
}

/** Stores a Principal in the TTL map for PRINCIPAL_TTL_MS milliseconds. Immutable entry. */
export function setCachedPrincipal(authUserId: string, principal: Principal): void {
  principalTtlMap.set(authUserId, {
    principal,
    expiresAt: Date.now() + PRINCIPAL_TTL_MS,
  });
}
