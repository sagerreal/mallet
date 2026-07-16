import { test } from "@playwright/test";

test("screenshot settings team certs", async ({ page }) => {
  // Login using relative URLs (baseURL from playwright config handles the host)
  await page.goto("/login");
  await page.waitForLoadState("networkidle");

  await page.getByLabel("Email").fill("owner@e2e.mallet.test");
  await page.getByLabel("Password").fill("e2e-password-1");
  await page.getByRole("button", { name: "Sign in" }).click();

  // Wait for successful redirect to dashboard
  await page.waitForURL("**/dashboard", { timeout: 20000 });
  await page.waitForLoadState("networkidle");

  // Navigate to settings - use longer timeout for this page
  await page.goto("/settings", { timeout: 40000 });
  await page.waitForLoadState("networkidle", { timeout: 40000 });

  // Give time for API calls to complete and content to render
  await page.waitForTimeout(3000);

  // Scroll to top first
  await page.evaluate(() => window.scrollTo(0, 0));

  // Try to find team section and scroll into view
  const teamText = page.getByText("Your team").first();
  const teamExists = await teamText.count();
  if (teamExists > 0) {
    await teamText.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
  }

  // Full page screenshot
  await page.screenshot({
    path: "/tmp/tqshot/team-cert-chips.png",
    fullPage: true,
  });
});
