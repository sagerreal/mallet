import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { canonicalRedirectUrl, CANONICAL_REDIRECT_STATUS } from "@/lib/canonical-host";

export async function middleware(request: NextRequest) {
  // Before the Supabase client is built: a request that is leaving does not need its session
  // refreshed, and the auth round-trip would be pure latency on a response nobody renders.
  // See lib/canonical-host.ts for why this exists and why it is a 307.
  const canonical = canonicalRedirectUrl(request.headers.get("host"), request.url);
  if (canonical) return NextResponse.redirect(canonical, CANONICAL_REDIRECT_STATUS);

  let response = NextResponse.next({ request });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // getClaims() verifies the JWT locally via the project's ES256 JWKS (cached after first fetch),
  // so the common case is a cacheable JWKS fetch (edge/CDN-cached) instead of an uncacheable
  // /auth/v1/user round-trip. It still calls getSession() internally, which triggers
  // _callRefreshToken() when the access-token is within its expiry margin — the ssr client's
  // onAuthStateChange handler writes the refreshed session back to cookies via setAll. Expired-token
  // refresh therefore works identically to getUser(), which always made a remote /auth/user call.
  // Source: @supabase/auth-js@2.110.0 GoTrueClient.ts getClaims() → getSession() → __loadSession().
  const authStart = Date.now();
  await supabase.auth.getClaims();
  const authDurMs = Date.now() - authStart;

  response.headers.append("Server-Timing", `auth;dur=${authDurMs}`);
  return response;
}

// Everything except static assets and the API routes that carry their own auth (tRPC Bearer, MCP,
// webhooks, cron).
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/|mcp).*)"],
};
