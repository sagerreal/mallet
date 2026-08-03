/**
 * One app, one hostname.
 *
 * `app.trymallet.com` and the project's `.vercel.app` aliases both serve the app, and nothing sent
 * one to the other — so whichever host you arrived on was the one you stayed on for the whole
 * session, because every in-app navigation is relative. It also self-perpetuated: signup sets the
 * confirmation link to `window.location.origin`, so confirming from a vercel host sent you back
 * there next time. A customer could be handed either hostname depending on where the shop was
 * standing when they sent the quote.
 *
 * The decision lives here rather than inline in middleware.ts so it can be tested as a pure
 * function — root-level files sit outside the lint config's TypeScript parser globs.
 */

export const CANONICAL_HOST = "app.trymallet.com";

/**
 * Explicit list, never "anything ending .vercel.app": preview deployments get their own
 * *.vercel.app hostnames, and redirecting those would make every preview untestable.
 */
export const NON_CANONICAL_HOSTS: ReadonlySet<string> = new Set([
  "mallet-app-snowy.vercel.app",
  "mallet-app-owenduggan2003-5496s-projects.vercel.app",
]);

/**
 * The canonical URL for a request, or null when it is already on the right host.
 *
 * @param host  the request's Host header
 * @param url   the full request URL, whose path and query are preserved across the hop
 */
export function canonicalRedirectUrl(host: string | null, url: string): string | null {
  if (!host || !NON_CANONICAL_HOSTS.has(host)) return null;
  const next = new URL(url);
  next.protocol = "https:";
  next.host = CANONICAL_HOST;
  next.port = "";
  return next.toString();
}

/**
 * 307, not 308.
 *
 * A permanent redirect is the textbook canonical-domain answer, but browsers cache it
 * indefinitely — and if the custom domain's DNS ever broke, the fallback host would be
 * unreachable from any browser that had already seen it. There is no SEO argument to trade
 * against that here: this is a logged-in app, not indexed content.
 */
export const CANONICAL_REDIRECT_STATUS = 307;
