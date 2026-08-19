import { execSync } from "node:child_process";
import type { NextConfig } from "next";

/**
 * The LAN addresses this machine answers on, for `allowedDevOrigins`.
 *
 * The native shell is a webview over a URL (see mallet-mobile/shell). Point it at the dev server to
 * get a save-and-see loop on a real device or the simulator, and every request then arrives from
 * `10.0.0.x` rather than localhost — which Next blocks for dev resources by default. The page still
 * server-renders, so it LOOKS fine; the client bundle never loads, React never hydrates, and every
 * button silently does nothing. That symptom reads as a broken app rather than a blocked origin.
 *
 * Computed rather than hard-coded because a laptop gets a new address on every network, and a stale
 * one brings the silent-no-hydration failure back. Dev only — `allowedDevOrigins` is ignored in a
 * production build.
 */
function lanHosts(): string[] {
  if (process.env.NODE_ENV === "production") return [];
  const found: string[] = [];
  // Each interface in its OWN try: `ipconfig getifaddr` exits non-zero for an interface that is
  // down or absent, and execSync throws on that — so asking for both in one command threw away a
  // perfectly good address from the other. That failure is silent and looks exactly like the bug
  // this function exists to prevent.
  for (const iface of ["en0", "en1"]) {
    try {
      const ip = execSync(`ipconfig getifaddr ${iface}`, { stdio: ["ignore", "pipe", "ignore"] })
        .toString()
        .trim();
      if (ip) found.push(ip);
    } catch {
      // Interface down or absent — the other one may still answer.
    }
  }
  return found;
}

const securityHeaders = [
  // Prevent MIME-type sniffing — browsers must honour the declared Content-Type.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Refuse to render the app inside an <iframe> — blocks clickjacking.
  { key: "X-Frame-Options", value: "DENY" },
  // Send the full origin as the Referer for same-origin requests; only the origin for
  // cross-origin HTTPS requests; nothing for cross-origin HTTP.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Two-year HSTS. includeSubDomains covers all subdomains (e.g. staging.trymallet.com).
  // NOTE: do not add preload until the domain is submitted to the HSTS preload list.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  // CSP intentionally omitted: the app uses hand-rolled inline styles throughout.
  // Add a CSP once the inline-style surface is audited and nonce-based delivery is in place.
];

const nextConfig: NextConfig = {
  // Lets the phone/simulator load the dev bundle over the LAN — see lanHosts().
  allowedDevOrigins: lanHosts(),
  // Module boundaries are enforced by ESLint (see T0.2), not by separate packages — one deployable.
  reactStrictMode: true,

  experimental: {
    // View Transitions API — crossfade on route changes (70 ms, see globals.css).
    // If this flag causes build failures, hydration warnings, or modal breakage, remove it
    // and keep only the inert CSS rules (they are safe in non-supporting browsers).
    viewTransition: true,
  },

  async headers() {
    return [
      {
        // Apply to every route.
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },

  /**
   * Analytics through our OWN origin.
   *
   * A large share of this audience runs a blocker, and every mainstream list drops requests to
   * posthog.com by hostname — so a straight browser-to-PostHog integration silently loses those
   * people, and loses them non-randomly: the technical, privacy-minded end of the market. Sending
   * to /ingest on our own domain and rewriting server-side keeps the data honest.
   *
   * skipTrailingSlashRedirect matters: without it Next 308-redirects /ingest/decide/ and the SDK
   * follows the redirect to the wrong host.
   */
  skipTrailingSlashRedirect: true,

  async rewrites() {
    return [
      // Static assets (the recorder script) come from the asset host, events from the ingest host.
      { source: "/ingest/static/:path*", destination: "https://us-assets.i.posthog.com/static/:path*" },
      { source: "/ingest/:path*", destination: "https://us.i.posthog.com/:path*" },
    ];
  },
};

export default nextConfig;
