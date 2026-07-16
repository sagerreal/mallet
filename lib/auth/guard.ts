import { cache } from "react";
import { redirect } from "next/navigation";
import type { Principal, Role } from "@mallet/identity";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getAppDeps } from "@/trpc/di";
import { logger } from "@mallet/shared/observability";
import { getCachedPrincipal, setCachedPrincipal } from "./principal-ttl-cache";

// ---------------------------------------------------------------------------
// Core: token → Principal (verify + TTL cache + DB resolve + timing logs)
// ---------------------------------------------------------------------------
// Two-phase approach to minimise latency on the common authenticated path:
//   1. tokenVerifier.verify() — local ES256 JWKS verify, network-free once JWKS
//      is warm (fetched once, cached). Extracts authUserId for the TTL map key.
//   2. principalTtlMap hit → return Principal without any DB round-trip.
//   3. TTL miss → authProvider.authenticate() resolves via app_resolve_principal
//      SQL, stores result in the TTL map for 60 s.
//
// Invalidation nuance: org role or field-crew changes take ≤60 s to propagate
// across warm serverless instances — acceptable given the domain's change rate.
//
// Server-Timing headers are not writable from Server Components (Next.js App
// Router), so guard + resolve durations are emitted via the structured logger
// on every call. They are cheap and provide the observability that Server-Timing
// would give in a middleware context.
const resolveWithTtl = async (token: string): Promise<Principal | null> => {
  const deps = getAppDeps();

  // Phase 1: local JWT verify (ES256 JWKS — network-free after first fetch).
  const guardStart = Date.now();
  const verified = await deps.tokenVerifier.verify(token);
  const guardMs = Date.now() - guardStart;

  if (!verified) {
    logger.info({ guardMs, resolveMs: 0, ttlHit: false }, "auth.guard.timing");
    return null;
  }

  // Phase 2: TTL cache check — skips the app_resolve_principal DB call.
  const resolveStart = Date.now();
  const cached = getCachedPrincipal(verified.authUserId);
  if (cached) {
    const resolveMs = Date.now() - resolveStart;
    logger.info({ guardMs, resolveMs, ttlHit: true }, "auth.guard.timing");
    return cached;
  }

  // Phase 3: DB resolve (app_resolve_principal SECURITY DEFINER function).
  // authProvider.authenticate re-verifies locally (cheap) then resolves the
  // DB principal. The re-verify overhead is negligible vs the DB round-trip.
  const result = await deps.authProvider.authenticate(token);
  const resolveMs = Date.now() - resolveStart;
  logger.info({ guardMs, resolveMs, ttlHit: false }, "auth.guard.timing");

  if (!result.ok) return null;
  setCachedPrincipal(verified.authUserId, result.value);
  return result.value;
};

// React cache() deduplicates calls with the same token within one render pass
// (e.g. nested layouts both calling guardRole produce one await, not two).
// The module TTL map provides cross-request warm-instance caching on top.
const resolveWithTtlCached = cache(resolveWithTtl);

// ---------------------------------------------------------------------------
// Authenticate an access token → Principal, failing closed to null.
// Used by getSessionPrincipal for callers that do not go through guardRole.
// ---------------------------------------------------------------------------
const principalFromToken = async (token: string | null | undefined): Promise<Principal | null> => {
  if (!token) return null;
  try {
    const result = await getAppDeps().authProvider.authenticate(token);
    return result.ok ? result.value : null;
  } catch {
    return null; // a transient auth-provider/network error must fail closed to re-auth, not a 500
  }
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

// Server-side session → Principal. Uses the SAME auth path as the API (Bearer → verify → resolve),
// so shells and backend can never disagree about who the caller is.
export const getSessionPrincipal = async (): Promise<Principal | null> => {
  const supabase = await createSupabaseServer();
  const { data } = await supabase.auth.getSession();
  return principalFromToken(data.session?.access_token);
};

// Layout guard: anonymous → login; authenticated-but-unprovisioned → welcome; wrong role → their
// own home. Defense in depth — every backend procedure re-checks the role regardless.
// Reads the session ONCE (no redundant second read) and verifies its token locally via getClaims.
export const guardRole = async (allowed: readonly Role[]): Promise<Principal> => {
  const supabase = await createSupabaseServer();
  const { data } = await supabase.auth.getSession();
  if (!data.session) redirect("/login");
  const principal = await resolveWithTtlCached(data.session.access_token);
  if (!principal) redirect("/welcome");
  if (!allowed.includes(principal.role)) redirect(principal.role === "tech" ? "/my-day" : "/dashboard");
  return principal;
};
