import { describe, it, expect, vi } from "vitest";

/**
 * One app, one hostname.
 *
 * `app.trymallet.com` and the project's `.vercel.app` aliases both served the app, and nothing sent
 * one to the other — so whichever host you arrived on was the one you stayed on for the session,
 * and signup's `emailRedirectTo: window.location.origin` fed it back to you next time.
 *
 * The case that must NOT regress is preview deployments: they get their own *.vercel.app
 * hostnames, and a blanket "ends with .vercel.app" rule would make every preview untestable.
 */

// The Supabase client is irrelevant to the redirect and expensive to stand up; the assertions here
// are all on requests that return before it is constructed, except the pass-through case.
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getClaims: async () => ({ data: null }) } }),
}));

import { middleware } from "./middleware";

const req = (host: string, path = "/dashboard") =>
  new Request(`https://${host}${path}`, { headers: { host } }) as unknown as Parameters<typeof middleware>[0];

describe("canonical host redirect", () => {
  it("sends the vercel production alias to the custom domain", async () => {
    const res = await middleware(req("mallet-app-snowy.vercel.app"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://app.trymallet.com/dashboard");
  });

  it("keeps the path and query — a shared quote link must survive the hop", async () => {
    const res = await middleware(req("mallet-app-snowy.vercel.app", "/q/abc123?utm=email"));
    expect(res.headers.get("location")).toBe("https://app.trymallet.com/q/abc123?utm=email");
  });

  it("redirects the project alias too", async () => {
    const res = await middleware(req("mallet-app-owenduggan2003-5496s-projects.vercel.app"));
    expect(res.headers.get("location")).toBe("https://app.trymallet.com/dashboard");
  });

  // THE REGRESSION GUARD. Preview deployments are *.vercel.app; redirecting them away would make
  // every preview URL useless for testing.
  it("leaves a preview deployment alone", async () => {
    const res = await middleware(req("mallet-pj1yt2kfv-owenduggan2003-5496s-projects.vercel.app"));
    expect(res.status).not.toBe(307);
  });

  it("leaves the canonical host alone — no redirect loop", async () => {
    const res = await middleware(req("app.trymallet.com"));
    expect(res.status).not.toBe(307);
  });

  it("leaves local development alone", async () => {
    const res = await middleware(req("localhost:3000"));
    expect(res.status).not.toBe(307);
  });

  // 307, not 308: a permanent redirect is cached indefinitely, and would make the fallback host
  // unreachable from any browser that had seen it if the custom domain's DNS ever broke.
  it("is temporary, so the fallback host stays reachable", async () => {
    const res = await middleware(req("mallet-app-snowy.vercel.app"));
    expect(res.status).toBe(307);
    expect(res.status).not.toBe(308);
  });
});
