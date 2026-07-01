import { test, expect, type Page } from "@playwright/test";

const login = async (page: Page) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("owner@e2e.mallet.test");
  await page.getByLabel("Password").fill("e2e-password-1");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/dashboard");
};

test("golden path: customer → quote → accept → job → complete → invoice → paid", async ({ page }) => {
  const name = `Golden ${Date.now()}`;
  await login(page);

  // Customer
  await page.goto("/customers");
  await page.getByRole("button", { name: "New customer" }).first().click();
  await page.getByLabel("Name").fill(name);
  await page.getByRole("button", { name: "Add customer" }).click();
  await page.getByText(name).first().click();

  // Quote
  await page.getByRole("button", { name: "New quote" }).click();
  await page.getByPlaceholder("Description").fill("Panel replacement");
  await page.getByLabel("Rate ($)").fill("450");
  await page.getByRole("button", { name: "Create draft" }).click();
  await page.getByRole("button", { name: "Send to customer" }).click();
  await page.getByRole("button", { name: "Mark accepted" }).click();

  // Job
  await page.getByRole("button", { name: "Create job" }).click();
  await page.getByRole("button", { name: "Start" }).click();
  await page.getByRole("button", { name: "Complete" }).click();

  // Invoice + payment
  await page.getByRole("button", { name: "Create invoice" }).click();
  await page.getByRole("button", { name: "Send invoice" }).click();
  await page.getByRole("button", { name: "Record payment" }).first().click();
  await page.getByRole("button", { name: "Record payment" }).last().click(); // submit with prefilled full balance
  await expect(page.getByText("paid").first()).toBeVisible();
});
