import { test, expect } from "@playwright/test";

test("composer assembly shot", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill("owner@e2e.mallet.test");
  await page.getByLabel(/password/i).fill("e2e-password-1");
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await page.waitForURL(/dashboard|home|today|jobs/i, { timeout: 30_000 });
  await page.goto("/composer");
  await page.waitForLoadState("networkidle");

  await page.getByLabel("Description, line 1").fill("Cedar privacy fence");
  await page.getByLabel("Quantity, line 1").fill("100");
  await page.getByLabel("Unit, line 1").fill("LF");
  await page.getByTitle("Price this line from the parts and labour under it").first().click();
  await page.getByLabel("Description, component 2").fill("Line posts, 4×4×8 cedar");
  await page.getByLabel("Quantity or math, component 2").fill("qty/8+1");
  await page.getByLabel("Unit, line 2").fill("ea");
  await page.getByLabel("Price, line 2").fill("24.30");
  await page.getByTitle("Price this line from the parts and labour under it").first().click();
  await page.getByLabel("Description, component 3").fill("Pickets, 6ft dog-ear");
  await page.getByLabel("Quantity or math, component 3").fill("qty*2");
  await page.getByLabel("Unit, line 3").fill("ea");
  await page.getByLabel("Price, line 3").fill("4.15");
  await page.getByLabel("Description, line 1").click();

  await page.screenshot({ path: "/tmp/shot-assembly.png", fullPage: false, clip: { x: 260, y: 380, width: 1020, height: 420 } });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({ path: "/tmp/shot-assembly-dark.png", clip: { x: 260, y: 380, width: 1020, height: 420 } });
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: "/tmp/shot-assembly-mobile.png", fullPage: true });
  expect(true).toBe(true);
});
