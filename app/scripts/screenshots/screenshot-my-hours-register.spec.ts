/**
 * scripts/screenshots/screenshot-my-hours-register.spec.ts
 * PR 3 visual check: the My hours register — summary strip, week pager, shift sheet.
 *
 * Shot against the E2E org's owner, who reaches /my-hours the same way a tech does (the field
 * surface is role-gated for what it WRITES, not for who may look at their own hours).
 */
import { test, type Page } from "@playwright/test";
import * as fs from "node:fs";

const DIR = "/tmp/hoursshot";

const login = async (page: Page) => {
  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Email").fill("owner@e2e.mallet.test");
  await page.getByLabel("Password").fill("e2e-password-1");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/dashboard", { timeout: 30_000 });
  await page.waitForLoadState("networkidle");
};

test.beforeAll(() => fs.mkdirSync(DIR, { recursive: true }));

test("my hours — the register", async ({ page }) => {
  await login(page);
  await page.goto("/my-hours");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(2500);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: `${DIR}/01-week.png`, fullPage: true });

  // The pager, one week back — where the seeded hours live.
  await page.getByRole("button", { name: "Previous week" }).click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${DIR}/02-prev-week.png`, fullPage: true });

  // Expand the first shift, if there is one.
  const chevron = page.getByRole("button", { name: /^Show what the/ }).first();
  if (await chevron.count()) {
    await chevron.click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${DIR}/03-expanded.png`, fullPage: true });
  }

  // The editor, under its own row.
  const pencil = page.getByRole("button", { name: /^Edit the shift on/ }).first();
  if (await pencil.count()) {
    await pencil.click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${DIR}/04-editing.png`, fullPage: true });
  }

  // Narrow: the strip stacks and the register scrolls inside itself.
  await page.setViewportSize({ width: 430, height: 900 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${DIR}/05-phone.png`, fullPage: true });
});
