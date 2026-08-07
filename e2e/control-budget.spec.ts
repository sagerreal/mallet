/**
 * e2e/control-budget.spec.ts
 * Disclosure guard (rule 5 — YAGNI / progressive disclosure). Counts the visible,
 * focusable controls a user must parse on each office route and holds each under a
 * committed ceiling, so a future change can't quietly crowd a screen back up.
 *
 * The ceilings have generous headroom over today's counts for two reasons: (1) the
 * list routes' counts are dominated by table ROWS, which scale with seed data and
 * are a low-cognitive-load repeating pattern, not distinct controls; (2) the guard
 * is meant to catch a screen *doubling*, not to freeze an exact number. Baseline
 * counts (2026-07, E2E seed) are noted beside each ceiling.
 *
 * Opt-in like the other e2e nets (needs the dev server + E2E owner). The tab-bar
 * Office redesign already resolved the audit's original "119 controls on one page"
 * finding — the Office surface is split across four routes below.
 */

import { test, expect } from "@playwright/test";
import { login, OWNER } from "./helpers/ui";

const FOCUSABLE = [
  "button:visible", "a[href]:visible", "input:visible", "select:visible",
  "textarea:visible", '[role="button"]:visible', '[role="tab"]:visible',
  '[role="switch"]:visible', '[role="checkbox"]:visible',
  '[tabindex]:not([tabindex="-1"]):visible',
].join(",");

// path · name · ceiling  (baseline count at commit time in the comment)
const ROUTES: ReadonlyArray<{ path: string; name: string; ceiling: number }> = [
  { path: "/dashboard", name: "office-today", ceiling: 70 },                    // 44
  { path: "/dashboard?tab=frontdesk", name: "office-frontdesk", ceiling: 60 },  // 36
  { path: "/dashboard?tab=pricebook", name: "office-pricebook", ceiling: 95 },  // 60
  { path: "/dashboard?tab=checklists", name: "office-checklists", ceiling: 50 },// 27
  { path: "/customers", name: "customers", ceiling: 85 },                       // 52
  { path: "/tasks", name: "tasks", ceiling: 45 },                               // 19
  { path: "/jobs", name: "jobs", ceiling: 70 },                                 // 41
  { path: "/money", name: "money", ceiling: 90 },                              // 57
  { path: "/settings", name: "settings", ceiling: 45 },                         // 22
];

test.describe("control budget — no office route may crowd past its ceiling", () => {
  test.describe.configure({ mode: "serial" });

  test("focusable controls per route stay under budget", async ({ page }) => {
    test.setTimeout(120_000);
    await login(page, OWNER);
    const over: string[] = [];
    for (const r of ROUTES) {
      await page.goto(r.path);
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(500);
      const n = await page.locator(FOCUSABLE).count();
      if (n > r.ceiling) over.push(`${r.name}: ${n} > ${r.ceiling}`);
    }
    expect(over, `over budget: ${over.join("; ")}`).toEqual([]);
  });
});
