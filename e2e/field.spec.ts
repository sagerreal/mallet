import { test, expect, type Page } from "@playwright/test";

const login = async (page: Page, email: string, expectedPath: string) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("e2e-password-1");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(`**${expectedPath}`);
};

test("office assigns a job; tech sees it on My Day, starts and completes it", async ({ page }) => {
  const name = `Field ${Date.now()}`;
  await login(page, "owner@e2e.mallet.test", "/dashboard");

  // Fastest path to an assignable job: customer → quote → accept → job.
  await page.goto("/customers");
  await page.getByRole("button", { name: "New customer" }).first().click();
  await page.getByLabel("Name").fill(name);
  await page.getByRole("button", { name: "Add customer" }).click();
  await page.getByText(name).first().click();
  await page.getByRole("button", { name: "New quote" }).click();
  await page.getByPlaceholder("Description").fill("Water heater swap");
  await page.getByLabel("Rate ($)").fill("900");
  await page.getByRole("button", { name: "Create draft" }).click();
  await page.getByRole("button", { name: "Send to customer" }).click();
  await page.getByRole("button", { name: "Mark accepted" }).click();
  await page.getByRole("button", { name: "Create job" }).click();
  // selectOption waits for the option to appear (ensures members are loaded).
  // Then we immediately wait for the assign tRPC response — the onChange fires the mutation
  // and clearCookies() can race it; awaiting the response ensures the DB write commits before
  // we clear the owner session.
  await page.getByLabel("Assigned to").selectOption({ label: "tech@e2e.mallet.test (tech)" });
  await page.waitForResponse(
    (resp) => resp.url().includes("/api/trpc") && resp.request().method() === "POST" && resp.status() === 200,
  );
  const jobUrl = page.url();

  // Tech side.
  await page.context().clearCookies();
  await login(page, "tech@e2e.mallet.test", "/my-day");
  await page.getByText("Water heater swap").first().click();
  await page.getByRole("button", { name: "Start job" }).click();
  await page.getByRole("button", { name: "Mark complete" }).click();
  await page.waitForURL("**/my-day");

  // The office route stays forbidden for the tech.
  await page.goto(jobUrl);
  await page.waitForURL("**/my-day");
});
