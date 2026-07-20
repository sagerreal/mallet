/**
 * e2e/keyboard.spec.ts
 * The half of accessibility axe cannot see: can a keyboard-only user actually
 * operate the app?
 *
 * The audit found 79 of 100 clickable non-button elements were keyboard-dead
 * (no role, no tabIndex, no key handler) — a class of defect that renders
 * perfectly and scans clean. These specs walk the real surfaces with Tab and
 * assert that focus lands on something, stays visible, and reaches the primary
 * action of each screen.
 */

import { test, expect, type Page } from "@playwright/test";
import { login, prepare, settle, OWNER } from "./helpers/ui";

/** Tab n times and return a description of whatever holds focus. */
async function tabTo(page: Page, n: number): Promise<string> {
  for (let i = 0; i < n; i++) await page.keyboard.press("Tab");
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return "BODY";
    const label = el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 40) ?? "";
    return `${el.tagName.toLowerCase()}:${label}`;
  });
}

/** Does the focused element render a visible focus indicator? */
async function focusIsVisible(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return false;
    const s = getComputedStyle(el);
    const ring = s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0;
    const shadow = s.boxShadow !== "none";
    return ring || shadow;
  });
}

test.describe("keyboard operability", () => {
  test.beforeEach(async ({ page }) => {
    await prepare(page, "light");
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page, OWNER);
  });

  test("Tab reaches real controls on the Office page — never dead-ends on BODY", async ({ page }) => {
    await page.goto("/dashboard");
    await settle(page);

    const seen: string[] = [];
    for (let i = 0; i < 12; i++) seen.push(await tabTo(page, 1));

    // Every stop must be a genuine control, not a focus black hole.
    const deadStops = seen.filter((s) => s === "BODY").length;
    expect(deadStops, `focus fell through to BODY: ${seen.join(" -> ")}`).toBe(0);
  });

  test("the focused element always shows a visible focus indicator", async ({ page }) => {
    await page.goto("/dashboard");
    await settle(page);

    const invisible: string[] = [];
    for (let i = 0; i < 10; i++) {
      const who = await tabTo(page, 1);
      if (!(await focusIsVisible(page))) invisible.push(who);
    }
    expect(invisible, `no visible focus ring on: ${invisible.join(", ")}`).toEqual([]);
  });

  test("the Office tab bar is operable by keyboard alone", async ({ page }) => {
    await page.goto("/dashboard");
    await settle(page);

    const frontDesk = page.getByRole("tab", { name: /Front Desk/ });
    await frontDesk.focus();
    await page.keyboard.press("Enter");
    await settle(page);
    await expect(frontDesk).toHaveAttribute("aria-selected", "true");
  });

  test("a modal traps focus and closes on Escape", async ({ page }) => {
    await page.goto("/customers");
    await settle(page);

    await page.getByRole("button", { name: /New customer/ }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog, "modals must expose role=dialog").toBeVisible({ timeout: 5000 });

    // Focus must start inside the dialog, not behind it.
    const insideAtOpen = await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"]');
      return !!d && !!document.activeElement && d.contains(document.activeElement);
    });
    expect(insideAtOpen, "focus should move into the dialog on open").toBe(true);

    // Tabbing must not escape the dialog.
    for (let i = 0; i < 15; i++) await page.keyboard.press("Tab");
    const stillInside = await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"]');
      return !!d && !!document.activeElement && d.contains(document.activeElement);
    });
    expect(stillInside, "focus escaped the dialog — no focus trap").toBe(true);

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  test("list rows that act as buttons are reachable and activatable", async ({ page }) => {
    await page.goto("/tasks");
    await settle(page);

    const row = page.getByRole("button", { name: /Edit task/ }).first();
    const count = await row.count();
    test.skip(count === 0, "no tasks in the E2E org to traverse");

    await row.focus();
    expect(await focusIsVisible(page), "task row shows no focus ring").toBe(true);
    await page.keyboard.press("Enter");
    await settle(page);
  });
});
