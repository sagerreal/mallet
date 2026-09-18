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
// Authenticate an access token → one of FOUR distinguishable outcomes.
// ---------------------------------------------------------------------------
// WHY THIS IS NOT `Principal | null`. It used to be, and every failure collapsed into the same
// null: no token, a bad token, a real account with no org, and "the database did not answer". The
// root route turns null into redirect("/welcome"), so during a connection-pooler outage a fully
// provisioned OWNER was shown "Set up your shop" — one button press from provisioning a SECOND org
// and buying it a phone number (identity-router's signup buys the shop its line). The old comment
// here said a transient error "must fail closed to re-auth"; the caller sent it to onboarding
// instead. Naming the outcomes is what makes the caller's choice explicit.
export type PrincipalLookup =
  /** Verified, and the account belongs to an org. */
  | { readonly status: "ok"; readonly principal: Principal }
  /** No token, or one that does not verify — the caller belongs at /login. */
  | { readonly status: "unauthenticated" }
  /** Verified, resolved, and genuinely a member of no org — the ONLY state /welcome is for. */
  | { readonly status: "unprovisioned" }
  /** We could not find out. A DB/pooler/JWKS failure is never an answer about membership. */
  | { readonly status: "unavailable" };

const errText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const lookupPrincipalFromToken = async (
  token: string | null | undefined,
): Promise<PrincipalLookup> => {
  if (!token) return { status: "unauthenticated" };
  const deps = getAppDeps();

  // Local ES256 verify FIRST — network-free once JWKS is warm — so an expired token is told apart
  // from a good token whose org lookup failed. Same two-phase shape as resolveWithTtl above.
  let verified: Awaited<ReturnType<typeof deps.tokenVerifier.verify>>;
  try {
    verified = await deps.tokenVerifier.verify(token);
  } catch (error) {
    // A JWKS fetch that fails is a network problem, not a verdict on this token.
    logger.error({ err: errText(error) }, "auth.lookup.verify_threw");
    return { status: "unavailable" };
  }
  if (!verified) return { status: "unauthenticated" };

  try {
    const result = await deps.authProvider.authenticate(token);
    // Once the token has verified locally, authenticate's only remaining failure is
    // "account is not provisioned in any org" — see SupabaseAuthProvider.
    return result.ok ? { status: "ok", principal: result.value } : { status: "unprovisioned" };
  } catch (error) {
    // DbPrincipalResolver runs app_resolve_principal over the pooled connection and does not catch,
    // so this is where an unreachable database lands. It must NOT read as "you have no workspace".
    logger.error({ err: errText(error) }, "auth.lookup.resolve_threw");
    return { status: "unavailable" };
  }
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

// Server-side session → the full outcome. Uses the SAME auth path as the API
// (Bearer → verify → resolve), so shells and backend can never disagree about who the caller is.
// Prefer this over getSessionPrincipal wherever the caller ROUTES on the answer: only this form
// can tell "no org" apart from "no database".
export const lookupSessionPrincipal = async (): Promise<PrincipalLookup> => {
  const supabase = await createSupabaseServer();
  const { data } = await supabase.auth.getSession();
  return lookupPrincipalFromToken(data.session?.access_token);
};

// The narrow form, for callers that only need "is there a principal" and do not branch on WHY not.
export const getSessionPrincipal = async (): Promise<Principal | null> => {
  const lookup = await lookupSessionPrincipal();
  return lookup.status === "ok" ? lookup.principal : null;
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
