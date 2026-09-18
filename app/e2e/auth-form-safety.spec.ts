/**
 * e2e/auth-form-safety.spec.ts
 *
 * Every auth screen is a real <form> whose `onSubmit` handler only exists after
 * React attaches. Submitted before then, the browser performs its DEFAULT
 * submission — and with no `method=` that is a GET, so the password ends up in
 * the URL, the history entry, the Referer header and every access log in between.
 *
 * This was live: submitting /login pre-hydration produced
 *   /login?email=owner%40e2e.mallet.test&password=e2e-password-1
 * The window is not theoretical — 48 ms on fast wifi, but 630 ms on a
 * 4x-CPU-throttled phone over 1.5 Mbps, which is the actual fleet. The form is
 * fully painted and looks ready for that entire time.
 *
 * Running with javaScriptEnabled:false is what makes this deterministic: it is
 * the pre-hydration state frozen permanently, with no race to lose.
 *
 * Two independent guards, both asserted:
 *   1. the submit control is disabled until hydration (so no submission happens)
 *   2. method="post" (so if one somehow escapes, the body — not the URL — carries it)
 */

import { test, expect } from "@playwright/test";

/** Every route with a form that carries a credential or an account identifier. */
const AUTH_ROUTES = ["/login", "/signup", "/forgot-password", "/reset-password", "/set-password"];

test.describe("auth forms cannot leak credentials before hydration", () => {
  // No JS at all — the exact state a phone is in for the first ~600ms.
  test.use({ javaScriptEnabled: false });

  for (const route of AUTH_ROUTES) {
    test(`${route} — form posts and submit is inert without JS`, async ({ page }) => {
      await page.goto(route, { waitUntil: "domcontentloaded" });

      const forms = await page.locator("form").all();
      expect(forms.length, `${route} rendered no form`).toBeGreaterThan(0);

      for (const form of forms) {
        // GET is the browser default and is what put the password in the URL.
        const method = ((await form.getAttribute("method")) ?? "get").toLowerCase();
        expect(method, `${route}: form method must not be GET`).toBe("post");
      }

      // Every submit control must be unusable until the handler exists.
      const submits = await page.locator('[type="submit"]').all();
      expect(submits.length, `${route} rendered no submit control`).toBeGreaterThan(0);
      for (const submit of submits) {
        expect(
          await submit.isDisabled(),
          `${route}: submit is live before hydration, so it can still native-submit`,
        ).toBe(true);
      }
    });
  }
});
