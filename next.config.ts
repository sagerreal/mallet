import type { NextConfig } from "next";

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
  // Module boundaries are enforced by ESLint (see T0.2), not by separate packages — one deployable.
  reactStrictMode: true,

  async headers() {
    return [
      {
        // Apply to every route.
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
