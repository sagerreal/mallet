import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * The app answers on several hostnames, and nothing used to send them to one place.
 *
 * Both `app.trymallet.com` and the project's `.vercel.app` aliases serve the app independently, so
 * whichever one you landed on is the one you stayed on — every in-app navigation is relative. It
 * also self-perpetuated: signup sets the confirmation link to `window.location.origin`, so
 * confirming from a vercel host sent you back to that host for the next session too. A customer
 * could end up holding either hostname depending on where the shop happened to be standing.
 *
 * An explicit list rather than "anything ending .vercel.app": preview deployments get their own
 * *.vercel.app hostnames, and redirecting those would make every preview untestable.
 *
 * 307 rather than 308 on purpose. A permanent redirect is the textbook canonical-domain answer,
 * but browsers cache it indefinitely — and if the custom domain's DNS ever broke, the fallback
 * host would be unreachable from any browser that had already seen the redirect. There is no SEO
 * argument here to trade against that: this is a logged-in app, not indexed content.
 */
const CANONICAL_HOST = "app.trymallet.com";
const REDIRECT_TO_CANONICAL = new Set([
  "mallet-app-snowy.vercel.app",
  "mallet-app-owenduggan2003-5496s-projects.vercel.app",
]);

export async function middleware(request: NextRequest) {
  const host = request.headers.get("host");
  if (host && REDIRECT_TO_CANONICAL.has(host)) {
    const url = new URL(request.url);
    url.protocol = "https:";
    url.host = CANONICAL_HOST;
    url.port = "";
    // Before the Supabase client is built: a request that is leaving does not need its session
    // refreshed, and the auth round-trip would be pure latency on a response nobody renders.
    return NextResponse.redirect(url, 307);
  }

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
