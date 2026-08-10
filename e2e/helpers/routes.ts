/**
 * e2e/helpers/routes.ts
 * The route inventory the UI safety net runs against — visual regression, axe,
 * and keyboard traversal all iterate this one list, so adding a route to the app
 * means adding it here once and inheriting all three checks.
 *
 * Excluded on purpose: token-gated public pages (/q/[token], /f/[token]) and
 * Stripe return pages (/pay/*), which need live tokens; and the redirect-only
 * routes /frontdesk, /pricebook, /quotes and /pipeline, whose destinations are covered here
 * directly (redirects also never settle into a stable screenshot).
 */

export type Audience = "office" | "field" | "public";

export interface RouteDef {
  /** URL to visit. */
  path: string;
  /** Stable slug used for screenshot filenames. */
  name: string;
  /** Which session is needed. */
  audience: Audience;
  /** Also shoot this route at mobile width. */
  mobile?: boolean;
  /**
   * Shoot the desktop screenshot at THIS viewport height instead of the standard 900.
   *
   * `fullPage` does not mean full CONTENT here. `.appshell` is `height:100vh;overflow:hidden` and
   * `main` is the scroller (app/prototype.css:155,356), so on desktop the document never scrolls:
   * `document.scrollHeight` is exactly the viewport, and a fullPage shot returns the fold and
   * nothing below it. (On phones `.appshell` goes `overflow:visible` and the document scrolls, so
   * the mobile shots have always captured everything.)
   *
   * Measured on /dashboard at 1440×900: main's content is 2720px against a 793px window — 1,927px
   * of the work board, most of two columns, absent from the baseline. Setting a height taller than
   * the content puts it all in frame. `visual.spec.ts` asserts nothing is left below the fold, so
   * a route that outgrows its height fails loudly instead of quietly clipping again.
   */
  desktopHeight?: number;
}

export const ROUTES: readonly RouteDef[] = [
  // --- public / auth -------------------------------------------------------
  { path: "/login", name: "login", audience: "public", mobile: true },
  { path: "/signup", name: "signup", audience: "public" },
  { path: "/forgot-password", name: "forgot-password", audience: "public" },

  // --- office --------------------------------------------------------------
  // The work board is the tallest office surface: 2,720px of content with 43 open items in the
  // E2E org. 3,200 clears that with room for the fixture to grow; the no-clipping assertion in
  // visual.spec.ts is what says when it stops being enough.
  { path: "/dashboard", name: "office-today", audience: "office", mobile: true, desktopHeight: 3200 },
  { path: "/dashboard?tab=frontdesk", name: "office-frontdesk", audience: "office", mobile: true },
  { path: "/dashboard?tab=pricebook", name: "office-pricebook", audience: "office", mobile: true },
  { path: "/dashboard?tab=checklists", name: "office-checklists", audience: "office" },
  { path: "/customers", name: "customers", audience: "office", mobile: true },
  { path: "/tasks", name: "tasks", audience: "office", mobile: true },
  { path: "/jobs", name: "jobs", audience: "office", mobile: true },
  { path: "/jobs?tab=schedule", name: "jobs-schedule", audience: "office" },
  { path: "/jobs?tab=timesheets", name: "jobs-timesheets", audience: "office" },
  { path: "/money", name: "money", audience: "office", mobile: true },
  { path: "/composer", name: "composer", audience: "office" },
  { path: "/messages", name: "messages", audience: "office" },
  { path: "/settings", name: "settings-workspace", audience: "office" },
  { path: "/settings?tab=team", name: "settings-team", audience: "office" },
  { path: "/settings?tab=channels", name: "settings-channels", audience: "office" },
  { path: "/settings?tab=payments", name: "settings-payments", audience: "office" },
  { path: "/settings?tab=quickbooks", name: "settings-quickbooks", audience: "office" },
  { path: "/account", name: "account", audience: "office" },
  { path: "/more", name: "more", audience: "office", mobile: true },

  // --- field ---------------------------------------------------------------
  { path: "/my-day", name: "field-my-day", audience: "field", mobile: true },
  { path: "/my-hours", name: "field-my-hours", audience: "field", mobile: true },
  { path: "/messages", name: "field-messages", audience: "field", mobile: true },
];

export const officeRoutes = ROUTES.filter((r) => r.audience === "office");
export const fieldRoutes = ROUTES.filter((r) => r.audience === "field");
export const publicRoutes = ROUTES.filter((r) => r.audience === "public");
