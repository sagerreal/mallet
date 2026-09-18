import { test, expect } from "@playwright/test";

const login = async (page: import("@playwright/test").Page, email: string) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("e2e-password-1");
  await page.getByRole("button", { name: "Sign in" }).click();
};

test("owner lands on the office dashboard", async ({ page }) => {
  await login(page, "owner@e2e.mallet.test");
  await page.waitForURL("**/dashboard");
  await expect(page.getByText("Mallet").first()).toBeVisible();
});

test("tech lands on My Day and cannot open office routes", async ({ page }) => {
  await login(page, "tech@e2e.mallet.test");
  await page.waitForURL("**/my-day");
  await page.goto("/dashboard");
  await page.waitForURL("**/my-day"); // office layout guard bounces tech back
});

test("anonymous is redirected to login", async ({ page }) => {
  await page.goto("/dashboard");
  await page.waitForURL("**/login");
});
