/**
 * e2e/mobile-overflow.spec.ts
 * The permanent horizontal-overflow net at the iPhone 393px breakpoint.
 *
 * Verified on production before this net existed: the office checklists pane,
 * pricebook pane, and frontdesk pane each have a header row (heading + search
 * input + action buttons) that does not wrap at 393px — the document scrolls
 * sideways, headings overlap inputs, buttons are clipped, and the fixed
 * `#mobiletabs` bar is dragged wide enough to slice its own tab labels.
 * settings-team overflows by a smaller margin from a member row that doesn't
 * shrink its role dropdown + toggles.
 *
 * Opt-in like the other visual/ergonomic nets — run against a PRODUCTION build,
 * not `next dev` (the dev-tools badge and HMR overlay are not shipped layout):
 *
 *     pnpm build && PORT=3134 pnpm start
 *     E2E_VISUAL=1 E2E_BASE_URL=http://localhost:3134 npx playwright test e2e/mobile-overflow.spec.ts
 */

import { test, expect } from "@playwright/test";
import { login, prepare, OWNER, TECH } from "./helpers/ui";

test.skip(!process.env.E2E_VISUAL, "set E2E_VISUAL=1 to run visual regression");

const VIEWPORT = { width: 393, height: 852 };

// 1px tolerance: sub-pixel layout rounding (device pixel ratio scaling, border
// hairlines) can put scrollWidth a fraction of a css px over innerWidth even
// when nothing is visibly overflowing. Anything past that is a real defect.
const TOLERANCE = 1;

const OWNER_ROUTES = [
  "/dashboard",
  "/dashboard?tab=frontdesk",
  "/dashboard?tab=pricebook",
  "/dashboard?tab=checklists",
  "/customers",
  "/pipeline",
  "/jobs",
  "/jobs?tab=schedule",
  "/jobs?tab=timesheets",
  "/money",
  "/tasks",
  "/composer",
  "/frontdesk",
  "/settings",
  "/settings?tab=team",
  "/settings?tab=channels",
  "/settings?tab=payments",
  "/settings?tab=quickbooks",
  "/more",
  "/quotes",
  "/pricebook",
];

const TECH_ROUTES = ["/my-day", "/my-hours", "/messages", "/account"];

test.describe.configure({ mode: "serial" });

/**
 * A lighter settle than helpers/ui's `settle()`. That helper's full-page
 * scroll-walk exists to force webfont swaps for pixel-perfect screenshots —
 * unneeded here, since this net only reads `scrollWidth` — and it is actively
 * unsafe on this route list: `/customers` runs IntersectionObserver-driven
 * infinite-scroll pagination (features/customers/companies-view.tsx), so
 * walking it to the bottom can trigger a fetch that grows `scrollHeight`
 * again, extending the walk's own upper bound. That combination hung this
 * spec for 25+ minutes before this fix. Network-idle + a settle beat + fonts
 * ready is enough to get a stable horizontal layout.
 */
async function settleForOverflowCheck(page: import("@playwright/test").Page): Promise<void> {
  // Explicit 10s cap rather than the navigation-timeout default: some routes
  // keep a live connection open (polling/SSE) and never truly go idle.
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
  await page.evaluate(() => document.fonts?.ready);
  await page.waitForTimeout(600);
}

async function assertNoOverflow(page: import("@playwright/test").Page, route: string): Promise<void> {
  await page.goto(route);
  await settleForOverflowCheck(page);
  const scrollWidth = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth));
  expect(scrollWidth, `${route} Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) (${scrollWidth}) overflows the ${VIEWPORT.width}px viewport`).toBeLessThanOrEqual(
    VIEWPORT.width + TOLERANCE,
  );
}

test.describe("mobile overflow — 393px", () => {
  test("office routes never scroll wider than the viewport", async ({ page }) => {
    // 21 routes × ~11s worst case (10s networkidle cap + settle beat).
    test.setTimeout(300_000);
    await prepare(page, "light");
    await page.setViewportSize(VIEWPORT);
    await login(page, OWNER);

    for (const route of OWNER_ROUTES) {
      await assertNoOverflow(page, route);
    }
  });

  test("field routes never scroll wider than the viewport", async ({ page }) => {
    test.setTimeout(300_000);
    await prepare(page, "light");
    await page.setViewportSize(VIEWPORT);
    await login(page, TECH);

    for (const route of TECH_ROUTES) {
      await assertNoOverflow(page, route);
    }
  });
});
