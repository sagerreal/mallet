/**
 * e2e/back-nav.spec.ts
 *
 * Browser Back after a FULL page load must leave the app painting.
 *
 * `@view-transition { navigation: auto }` opts into CROSS-document view transitions. On a
 * back/forward navigation Chromium skips the transition ("Transition was skipped") and never
 * un-suppresses rendering: the DOM stays readable, requestAnimationFrame never fires again, and no
 * click is processed. The user is frozen on the previous screen until they force a reload.
 *
 * It only bites after a hard load, which is exactly how the app is entered from an OAuth callback
 * — the QuickBooks redirect lands on /settings?tab=quickbooks and Stripe Connect's return URL has
 * the same shape. So the freeze sat directly behind "connect your accounting".
 *
 * The test asserts the thing that actually broke: that a frame is still produced after Back.
 */
import { test, expect } from "@playwright/test";
import { login, OWNER } from "./helpers/ui";

/** Resolves true if the document paints within `ms`. A suppressed document never calls back. */
async function paints(page: import("@playwright/test").Page, ms = 3000): Promise<boolean> {
  return page.evaluate(
    (limit) =>
      new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), limit);
        requestAnimationFrame(() => {
          clearTimeout(timer);
          resolve(true);
        });
      }),
    ms,
  );
}

test("browser Back after a hard load keeps painting", async ({ page }) => {
  await login(page, OWNER);

  // A FULL page load of a deep link — a bookmark, a pasted URL, or an OAuth callback.
  await page.goto("/settings?tab=quickbooks", { waitUntil: "load" });
  expect(await paints(page)).toBe(true); // sanity: healthy before Back

  await page.goBack({ waitUntil: "commit" });

  expect(await paints(page)).toBe(true);
  // And input still lands — a suppressed document accepts no clicks.
  await page.locator("body").click({ timeout: 5000 });
});
