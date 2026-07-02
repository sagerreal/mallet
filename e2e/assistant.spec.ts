import { test, expect } from "@playwright/test";

test("assistant answers a read question (LIVE Anthropic — opt-in)", async ({ page }) => {
  test.skip(!process.env.E2E_AI, "set E2E_AI=1 to run the live assistant spec");
  await page.goto("/login");
  await page.getByLabel("Email").fill("owner@e2e.mallet.test");
  await page.getByLabel("Password").fill("e2e-password-1");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/dashboard");
  await page.goto("/assistant");
  await page.getByLabel("Message").fill("How many customers do we have? Answer with just details from customer_list.");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.locator("text=/customer/i").last()).toBeVisible({ timeout: 60_000 });
});
