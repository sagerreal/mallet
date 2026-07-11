import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { TokenVerifier, VerifiedToken } from "../domain/auth-provider";

// Verifies a Supabase access token LOCALLY via getClaims: it validates the JWT's signature +
// expiry against the project's asymmetric (ES256) JWKS, which the client fetches once and caches —
// no per-request network round-trip to the Auth server (getUser did one on every call, and it was
// the dominant cost of the server-side auth gate). The cookie-stored token is untrusted until this
// verifies it. Trade-off: local verification does not reflect a server-side-revoked token until it
// expires; acceptable given short token lifetimes (this is Supabase's sanctioned getClaims path).
export class SupabaseTokenVerifier implements TokenVerifier {
  constructor(private readonly client: SupabaseClient) {}

  async verify(accessToken: string): Promise<VerifiedToken | null> {
    const { data, error } = await this.client.auth.getClaims(accessToken);
    if (error || !data) return null;
    const claims = data.claims;
    const authUserId = typeof claims.sub === "string" ? claims.sub : null;
    if (!authUserId) return null;
    const meta = (claims.user_metadata ?? {}) as Record<string, unknown>;
    const name =
      typeof meta.full_name === "string" && meta.full_name.trim()
        ? meta.full_name.trim()
        : typeof meta.name === "string" && meta.name.trim()
          ? meta.name.trim()
          : null;
    return {
      authUserId,
      email: typeof claims.email === "string" ? claims.email : "",
      orgNameHint: typeof meta.org_name === "string" ? meta.org_name : null,
      name,
    };
  }
}

export const createSupabaseTokenVerifier = (url: string, anonKey: string): SupabaseTokenVerifier =>
  new SupabaseTokenVerifier(
    createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } }),
  );
