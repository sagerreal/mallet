import { test, expect } from "@playwright/test";

// A manually created job (with a new customer) survives a full page reload and
// appears on the board.  This exercises the full createJob async chain:
//   addLead (new customer) → await persisted (server lead id) →
//   addJob (v1.jobs.create with real FK) → await persisted (origin "db") →
//   addVisit (v1.visits.createVisit persists because origin is "db").
//
// Requires the seeded E2E org (npm run seed:e2e) + a running dev server.
test("manual job persists across refresh", async ({ page }) => {
  await page.goto("/jobs");
  await page.getByRole("button", { name: /new job/i }).click();
  await page.getByPlaceholder("e.g. water heater repair").fill("E2E water heater");
  await page.getByLabel("Customer").fill("E2E Persist Cust");
  await page.getByRole("button", { name: /create job/i }).click();

  await expect(page.getByText("E2E water heater")).toBeVisible();
  await page.reload();
  await expect(page.getByText("E2E water heater")).toBeVisible();
});
