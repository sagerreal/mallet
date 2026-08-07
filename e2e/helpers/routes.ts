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
}

export const ROUTES: readonly RouteDef[] = [
  // --- public / auth -------------------------------------------------------
  { path: "/login", name: "login", audience: "public", mobile: true },
  { path: "/signup", name: "signup", audience: "public" },
  { path: "/forgot-password", name: "forgot-password", audience: "public" },

  // --- office --------------------------------------------------------------
  { path: "/dashboard", name: "office-today", audience: "office", mobile: true },
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
