/**
 * components/shell/tab-roots.ts
 * Which routes the bottom tab bar can reach, and where "back" goes for the ones it
 * cannot.
 *
 * On a phone the tab bar is the ONLY navigation, and it reaches nine routes. Every
 * other route — /tasks, /composer, /settings, /jobs/:id, /money/:id — was
 * a dead end: no back affordance existed anywhere in the app, and inside a WKWebView
 * there is no browser chrome to fall back on. Tapping a tab escaped but threw away
 * where you were.
 *
 * Kept in step with components/shell/mobile-tabs.tsx BY TEST, not by hope — if a tab
 * is added or removed there without updating TAB_ROOTS, tab-roots.test.ts fails.
 */

/** Every destination reachable from the bottom tab bar (office tabs + field tabs).
 * /more is NOT one anymore — it moved to the topbar ⋯ so the create button sits
 * dead-center — so it now carries a back control like any other off-bar route. */
export const TAB_ROOTS = [
  "/dashboard",
  "/customers",
  "/jobs",
  "/money",
  "/my-day",
  "/my-hours",
  "/messages",
  // Ask moved out of the tech job sheet onto its own field tab — a chat with follow-ups and
  // long answers needs a screen, not a panel inside the job it is about.
  "/ask",
  "/account",
] as const;

const normalise = (pathname: string): string =>
  pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;

/**
 * True when the route is itself a tab destination, so the tab bar already shows the
 * way out and a back control would be noise.
 *
 * Note this is an EXACT match, not a prefix one: /jobs is a root but /jobs/:id is
 * not — a detail view needs a way back to its list.
 */
export function isTabRoot(pathname: string): boolean {
  return (TAB_ROOTS as readonly string[]).includes(normalise(pathname));
}

/**
 * Where back should land when there is no history to pop — i.e. the app was cold-
 * opened straight onto a deep route, which happens every time the native shell is
 * launched from a notification or a saved link.
 *
 * A detail route falls back to its own list. A flat office route falls back to the
 * office home. /settings falls back to /more, because More is how a phone reaches
 * Settings at all.
 */
export function parentRouteOf(pathname: string): string {
  const path = normalise(pathname);
  const segments = path.split("/").filter(Boolean);

  // /jobs/:id -> /jobs, /money/:id -> /money
  if (segments.length > 1) {
    const parent = `/${segments.slice(0, -1).join("/")}`;
    if (parent !== path) return parent;
  }

  if (path === "/settings") return "/more";
  return "/dashboard";
}
