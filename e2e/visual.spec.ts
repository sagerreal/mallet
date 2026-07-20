/**
 * e2e/visual.spec.ts
 * Visual regression baseline for the UI rework. Every route in the inventory is
 * shot at desktop light + dark, and the marked ones again at mobile width.
 *
 * These baselines are the safety net for the token/primitive migration: an
 * unintended pixel change on ANY screen fails the run, and intended changes are
 * reviewed and re-baselined deliberately (`--update-snapshots`).
 *
 * Opt-in — visual diffing is machine-specific, so it runs when E2E_VISUAL=1
 * (and in CI, on a pinned container) rather than on every local `test:e2e`.
 */

import { test, expect } from "@playwright/test";
import { ROUTES, type RouteDef } from "./helpers/routes";
import { login, prepare, settle, dynamicRegions, OWNER, TECH } from "./helpers/ui";

test.skip(!process.env.E2E_VISUAL, "set E2E_VISUAL=1 to run visual regression");

const THEMES = ["light", "dark"] as const;
const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };

async function shoot(page: import("@playwright/test").Page, route: RouteDef, theme: string, size: string) {
  await settle(page);
  await expect(page).toHaveScreenshot(`${route.name}-${theme}-${size}.png`, {
    fullPage: true,
    animations: "disabled",
    mask: dynamicRegions(page),
    maxDiffPixelRatio: 0.01,
    timeout: 20_000,
  });
}

for (const theme of THEMES) {
  test.describe(`visual · ${theme}`, () => {
    for (const route of ROUTES) {
      test(`${route.name} · desktop`, async ({ page }) => {
        await prepare(page, theme);
        await page.setViewportSize(DESKTOP);
        if (route.audience === "office") await login(page, OWNER);
        if (route.audience === "field") await login(page, TECH);
        await page.goto(route.path);
        await shoot(page, route, theme, "desktop");
      });

      if (route.mobile) {
        test(`${route.name} · mobile`, async ({ page }) => {
          await prepare(page, theme);
          await page.setViewportSize(MOBILE);
          if (route.audience === "office") await login(page, OWNER);
          if (route.audience === "field") await login(page, TECH);
          await page.goto(route.path);
          await shoot(page, route, theme, "mobile");
        });
      }
    }
  });
}
