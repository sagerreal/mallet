/**
 * Re-add Backflow cert to owner and capture all final T5/T6 screenshots.
 */

import { test, type Page } from "@playwright/test";
import * as fs from "node:fs";

const DIR = "/tmp/tqshot/t6";
const BASE = "http://localhost:3001";

async function login(page: Page) {
  await page.goto(`${BASE}/login`);
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Email").fill("owner@e2e.mallet.test");
  await page.getByLabel("Password").fill("e2e-password-1");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/dashboard", { timeout: 25_000 });
  await page.waitForLoadState("networkidle");
}

test.beforeAll(() => {
  fs.mkdirSync(DIR, { recursive: true });
});

test("Re-add Backflow cert to owner then capture T5 modal banners", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await login(page);

  // Re-add Backflow cert via settings
  await page.goto(`${BASE}/settings`);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(2500);

  await page.screenshot({ path: `${DIR}/t6-readd-01-settings.png`, fullPage: true });

  // Find owner's cert section specifically (scroll to CERTIFICATIONS section for owner row)
  // Settings page shows: owner row first with CERTIFICATIONS subsection
  const allCertInputs = await page.locator("input[placeholder='Add certification']").all();
  console.log("Cert inputs found:", allCertInputs.length);

  const firstCertInput = allCertInputs[0];
  if (firstCertInput != null) {
    // Use the first one (for the first user = owner)
    await firstCertInput.fill("Backflow");
    await firstCertInput.press("Enter");
    await page.waitForTimeout(1000);
    console.log("Typed Backflow into first cert input");

    // Check if a Backflow chip appeared
    const backflowChip = page.locator("text=Backflow").first();
    const chipCount = await backflowChip.count();
    console.log("Backflow chip appeared:", chipCount > 0);

    // Click Save (there should be a save button near the cert input)
    const saveButtons = await page.getByRole("button", { name: /^save$/i }).all();
    console.log("Save buttons:", saveButtons.length);
    const firstSave = saveButtons[0];
    if (firstSave != null) {
      await firstSave.click();
      await page.waitForTimeout(2000);
      console.log("Clicked Save");
    }
  }

  await page.screenshot({ path: `${DIR}/t6-readd-02-after-save.png`, fullPage: true });
  console.log("After re-add:", `${DIR}/t6-readd-02-after-save.png`);

  // Now open JOB-1011 modal (scheduled, has visit on tech — who lacks Backflow; owner has Backflow)
  await page.goto(`${BASE}/jobs?tab=jobs`);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(3000);

  await page.screenshot({ path: `${DIR}/t6-readd-03-jobs-list.png` });

  // Click row 6 (JOB-1011 — Scheduled, Fri 8a, TE tech, Water heater swap)
  const rows = page.locator("main tr");
  let targetRow = -1;
  const rowCount = await rows.count();
  for (let i = 1; i < rowCount; i++) {
    const txt = (await rows.nth(i).textContent().catch(() => "")) ?? "";
    if (txt.includes("Water heater swap") && txt.includes("tech")) {
      targetRow = i;
      console.log(`Row ${i}: "${txt.trim().slice(0, 100)}"`);
      break;
    }
  }
  if (targetRow === -1) targetRow = 6;

  await page.locator("main tr").nth(targetRow).click({ timeout: 8000 });
  await page.waitForTimeout(2500);

  const bodyText = await page.locator("body").textContent().catch(() => "") ?? "";
  console.log("Modal has Backflow:", bodyText.includes("Backflow"));
  console.log("Modal has certified:", bodyText.includes("certified"));
  console.log("Modal has missing:", bodyText.includes("missing"));

  const banners = await page.locator(".banner").all();
  for (const b of banners) {
    console.log("Banner:", (await b.textContent().catch(() => ""))?.trim().slice(0, 150));
  }

  const selects = await page.locator("select").all();
  for (const sel of selects) {
    const opts = await sel.locator("option").all();
    for (const opt of opts) {
      console.log("  Opt:", (await opt.textContent().catch(() => ""))?.trim().slice(0, 60));
    }
  }

  // Full modal screenshot
  await page.screenshot({ path: `${DIR}/t6-T5-MODAL-FULL.png`, fullPage: true });
  console.log("Modal full:", `${DIR}/t6-T5-MODAL-FULL.png`);

  // Scroll to see visit rows
  await page.evaluate(() => window.scrollBy(0, 400));
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${DIR}/t6-T5-MODAL-SCROLLED.png` });

  // Find skill banner — currently tech is assigned (unqualified), should show missing
  const skillBanners = page.locator(".banner").filter({ hasText: /Backflow|certified|missing|Needs/i });
  const count = await skillBanners.count();
  console.log("Skill banners:", count);

  if (count > 0) {
    await skillBanners.first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${DIR}/t6-T5-MISSING-BANNER-FINAL.png` });
    console.log("T5 MISSING BANNER:", `${DIR}/t6-T5-MISSING-BANNER-FINAL.png`);

    // Switch to qualified tech (owner has Backflow)
    const crewSelect = page.locator("select").first();
    if (await crewSelect.count() > 0) {
      const opts = await crewSelect.locator("option").all();
      for (const opt of opts) {
        const txt = (await opt.textContent().catch(() => "")) ?? "";
        const val = (await opt.getAttribute("value").catch(() => "")) ?? "";
        // Select the option WITHOUT "missing" text (the qualified one)
        if (val && !txt.toLowerCase().includes("missing") && !txt.toLowerCase().includes("unassigned") && txt.trim().length > 1) {
          console.log("Switching crew to:", txt.trim());
          await crewSelect.selectOption(val);
          await page.waitForTimeout(1200);
          await page.screenshot({ path: `${DIR}/t6-T5-QUALIFIED-BANNER-FINAL.png` });
          console.log("T5 QUALIFIED BANNER:", `${DIR}/t6-T5-QUALIFIED-BANNER-FINAL.png`);
          break;
        }
      }
    }
  }

  // Final scrolled view
  await page.screenshot({ path: `${DIR}/t6-MODAL-DONE.png`, fullPage: true });
});
