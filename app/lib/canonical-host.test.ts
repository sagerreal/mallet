import { describe, it, expect } from "vitest";
import { canonicalRedirectUrl, CANONICAL_REDIRECT_STATUS } from "./canonical-host";

/**
 * One app, one hostname.
 *
 * Both `app.trymallet.com` and the project's `.vercel.app` aliases served the app, and nothing
 * sent one to the other — so whichever host you arrived on was the one you stayed on, and
 * signup's `emailRedirectTo: window.location.origin` fed it back to you next session.
 *
 * The case that must NOT regress is preview deployments: they get their own *.vercel.app
 * hostnames, and a blanket "ends with .vercel.app" rule would make every preview untestable.
 */

describe("canonicalRedirectUrl", () => {
  it("sends the vercel production alias to the custom domain", () => {
    expect(canonicalRedirectUrl("mallet-app-snowy.vercel.app", "https://mallet-app-snowy.vercel.app/dashboard"))
      .toBe("https://app.trymallet.com/dashboard");
  });

  it("keeps path and query — a shared quote link must survive the hop", () => {
    expect(canonicalRedirectUrl("mallet-app-snowy.vercel.app", "https://mallet-app-snowy.vercel.app/q/abc?utm=email"))
      .toBe("https://app.trymallet.com/q/abc?utm=email");
  });

  it("redirects the project alias too", () => {
    expect(canonicalRedirectUrl(
      "mallet-app-owenduggan2003-5496s-projects.vercel.app",
      "https://mallet-app-owenduggan2003-5496s-projects.vercel.app/jobs",
    )).toBe("https://app.trymallet.com/jobs");
  });

  // THE REGRESSION GUARD. Preview deployments are *.vercel.app; redirecting them away would make
  // every preview URL useless for testing.
  it("leaves a preview deployment alone", () => {
    expect(canonicalRedirectUrl(
      "mallet-pj1yt2kfv-owenduggan2003-5496s-projects.vercel.app",
      "https://mallet-pj1yt2kfv-owenduggan2003-5496s-projects.vercel.app/dashboard",
    )).toBeNull();
  });

  it("leaves the canonical host alone — no redirect loop", () => {
    expect(canonicalRedirectUrl("app.trymallet.com", "https://app.trymallet.com/dashboard")).toBeNull();
  });

  it("leaves local development alone", () => {
    expect(canonicalRedirectUrl("localhost:3000", "http://localhost:3000/dashboard")).toBeNull();
  });

  it("does nothing without a Host header rather than guessing", () => {
    expect(canonicalRedirectUrl(null, "https://app.trymallet.com/dashboard")).toBeNull();
  });

  // Temporary on purpose: a cached permanent redirect would strand the fallback host if the
  // custom domain's DNS ever broke.
  it("redirects temporarily, so the fallback host stays reachable", () => {
    expect(CANONICAL_REDIRECT_STATUS).toBe(307);
  });
});
