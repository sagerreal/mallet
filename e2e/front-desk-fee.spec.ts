/**
 * e2e/front-desk-fee.spec.ts
 *
 * The Front Desk service-call fee is the shop's real diagnostic price. It used to parse on every
 * keystroke straight into a persisted booking-config write, so typing "125" stored $1 and then
 * $12 on the way, and clearing the box to retype stored $0 — with no Save button, no confirmation
 * and no undo.
 *
 * Counts the actual settings writes rather than trusting the UI.
 */
import { test, expect } from "@playwright/test";
import { login, OWNER, settle } from "./helpers/ui";

const FEE_BOX = 'input[aria-label="Service call fee in dollars"]';

async function openFeeRule(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/dashboard?tab=frontdesk");
  await settle(page);
  await page.getByText("Service call fee").first().click();
  await page.locator(FEE_BOX).waitFor({ state: "visible" });
}

test("typing the fee writes once, on blur — not once per digit", async ({ page }) => {
  await login(page, OWNER);
  await openFeeRule(page);

  const box = page.locator(FEE_BOX);
  const original = await box.inputValue();

  let writes = 0;
  page.on("request", (r) => {
    if (r.url().includes("v1.settings.updateConfig")) writes += 1;
  });

  await box.click();
  await box.fill("");
  await box.type("125", { delay: 30 });
  expect(writes).toBe(0); // $1 and $12 are not the shop's fee

  await box.blur();
  await expect.poll(() => writes).toBe(1);

  // Put it back the way it was found — this is the shared org.
  await box.click();
  await box.fill(original);
  await box.blur();
  await expect.poll(() => writes).toBe(2);
});

test("clearing the box to retype does not store $0", async ({ page }) => {
  await login(page, OWNER);
  await openFeeRule(page);

  const box = page.locator(FEE_BOX);
  const original = await box.inputValue();
  expect(original).not.toBe(""); // the fixture must actually have a fee for this to mean anything

  await box.click();
  await box.fill(""); // select-all + delete
  await box.blur();

  await expect(box).toHaveValue(original);

  await page.reload();
  await settle(page);
  await page.getByText("Service call fee").first().click();
  await expect(page.locator(FEE_BOX)).toHaveValue(original);
});
