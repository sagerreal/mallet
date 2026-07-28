/**
 * components/shell/tab-roots.test.ts
 *
 * The bottom tab bar is the only navigation on a phone, and it reaches 9 routes.
 * Everything else — /pipeline, /tasks, /composer, /settings, /jobs/:id, /money/:id —
 * is a DEAD END: no back affordance existed anywhere in the app (`router.back()`
 * appeared zero times), and in a WKWebView there is no browser chrome to fall back
 * on. Tapping a tab escapes but loses your place.
 *
 * These two predicates decide when the topbar shows a back control and where it
 * goes when there is no history to pop (a cold deep-link).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { isTabRoot, parentRouteOf, TAB_ROOTS } from "./tab-roots";

describe("TAB_ROOTS stays in step with the actual tab bar", () => {
  // The two lists live apart (mobile-tabs builds its entries inside a component with
  // hooks and counts, so it cannot be imported here). This reads its source instead,
  // which is enough to fail the build if a tab is added or removed without updating
  // TAB_ROOTS — the drift would silently put a back control on a tab, or leave a new
  // dead end without one.
  it("covers exactly the hrefs mobile-tabs renders", () => {
    const source = readFileSync(new URL("./mobile-tabs.tsx", import.meta.url), "utf8");
    const hrefs = new Set([...source.matchAll(/href: "([^"]+)"/g)].map((m) => m[1]));
    expect([...hrefs].sort()).toEqual([...TAB_ROOTS].sort());
  });
});

describe("isTabRoot", () => {
  it("treats every bottom-tab destination as a root (no back control)", () => {
    for (const route of ["/dashboard", "/customers", "/jobs", "/money", "/more", "/my-day", "/my-hours", "/messages", "/account"]) {
      expect(isTabRoot(route), route).toBe(true);
    }
  });

  it("treats the dead-end routes as non-roots (back control shown)", () => {
    for (const route of ["/pipeline", "/tasks", "/composer", "/settings"]) {
      expect(isTabRoot(route), route).toBe(false);
    }
  });

  it("treats a detail route as a non-root even though its parent is a tab", () => {
    expect(isTabRoot("/jobs/abc-123")).toBe(false);
    expect(isTabRoot("/money/inv-9")).toBe(false);
  });

  it("ignores a trailing slash", () => {
    expect(isTabRoot("/jobs/")).toBe(true);
  });
});

describe("parentRouteOf", () => {
  it("sends a detail route back to its list", () => {
    expect(parentRouteOf("/jobs/abc-123")).toBe("/jobs");
    expect(parentRouteOf("/money/inv-9")).toBe("/money");
  });

  it("sends a flat office route to the office home", () => {
    expect(parentRouteOf("/pipeline")).toBe("/dashboard");
    expect(parentRouteOf("/tasks")).toBe("/dashboard");
    expect(parentRouteOf("/composer")).toBe("/dashboard");
  });

  it("sends settings to the More menu, which is where a phone reaches it", () => {
    expect(parentRouteOf("/settings")).toBe("/more");
  });

  it("never returns the route it was given, which would be a no-op back", () => {
    for (const route of ["/pipeline", "/tasks", "/composer", "/settings", "/jobs/x", "/money/y"]) {
      expect(parentRouteOf(route), route).not.toBe(route);
    }
  });
});
