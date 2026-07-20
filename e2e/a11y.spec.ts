/**
 * e2e/a11y.spec.ts
 * Automated accessibility scan (axe-core) across the route inventory.
 *
 * Phase 0 runs this in REPORTING mode: it prints the per-route violation counts
 * and writes e2e/.a11y-baseline.json, establishing the number the rework drives
 * to zero. Phase 7 flips ALLOW_VIOLATIONS to 0 so any regression fails the build.
 *
 * Honest scope note: axe catches roughly half of WCAG issues. It is the floor,
 * not the proof — keyboard.spec.ts and manual review cover the rest.
 */

import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { writeFileSync } from "node:fs";
import { ROUTES } from "./helpers/routes";
import { login, prepare, settle, OWNER, TECH } from "./helpers/ui";

/** Phase 7 sets this to 0. Until then the scan reports rather than blocks. */
const ALLOW_VIOLATIONS = Number(process.env.A11Y_MAX ?? Number.POSITIVE_INFINITY);

const results: Record<string, { violations: number; ids: string[] }> = {};

test.describe.configure({ mode: "serial" });

for (const route of ROUTES) {
  test(`a11y · ${route.name}`, async ({ page }) => {
    await prepare(page, "light");
    await page.setViewportSize({ width: 1440, height: 900 });
    if (route.audience === "office") await login(page, OWNER);
    if (route.audience === "field") await login(page, TECH);
    await page.goto(route.path);
    await settle(page);

    const scan = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();

    const ids = scan.violations.map((v) => `${v.id}(${v.nodes.length})`);
    results[route.name] = { violations: scan.violations.length, ids };
    console.log(`[a11y] ${route.name}: ${scan.violations.length} violation types — ${ids.join(", ") || "clean"}`);

    expect(scan.violations.length).toBeLessThanOrEqual(ALLOW_VIOLATIONS);
  });
}

test.afterAll(() => {
  const total = Object.values(results).reduce((n, r) => n + r.violations, 0);
  writeFileSync("e2e/.a11y-baseline.json", JSON.stringify({ total, routes: results }, null, 2));
  console.log(`[a11y] TOTAL violation types across ${Object.keys(results).length} routes: ${total}`);
});
