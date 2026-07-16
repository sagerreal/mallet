/**
 * e2e/screenshot-t6-modal.spec.ts
 * T5/T6 modal banners: JOB-1011 is placed on unqualified tech → ⚠ missing banner.
 * Then reassign via crew select to owner (qualified) → ✓ certified banner.
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

test("T5+T6 — job modal: ⚠ missing banner then ✓ qualified banner", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await login(page);

  // Go to jobs list
  await page.goto(`${BASE}/jobs?tab=jobs`);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(3000);

  await page.screenshot({ path: `${DIR}/t6-modal-01-jobs-list.png` });

  // List all rows for debugging
  const rows = page.locator("main tr");
  const rowCount = await rows.count();
  console.log("Job rows:", rowCount);
  for (let i = 0; i < rowCount; i++) {
    const txt = (await rows.nth(i).textContent().catch(() => "")) ?? "";
    console.log(`  Row ${i}: "${txt.trim().slice(0, 100)}"`);
  }

  // Click the Water heater swap row (JOB-1011 — it's scheduled with a placed visit on unqualified tech)
  const whRow = page.locator("main tr").filter({ hasText: "Water heater swap" }).first();
  if (await whRow.count() === 0) {
    console.log("SCREENSHOT_NOTE: No 'Water heater swap' row found. Trying first data row.");
    if (rowCount > 1) {
      await page.locator("main tr").nth(1).click({ timeout: 8000 });
    }
  } else {
    await whRow.click({ timeout: 8000 });
  }

  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${DIR}/t6-modal-02-opened.png` });
  console.log("Modal opened:", `${DIR}/t6-modal-02-opened.png`);

  // Check page structure inside the modal
  const modalText = await page.locator("body").textContent().catch(() => "") ?? "";
  console.log("Page text contains 'Backflow':", modalText.includes("Backflow"));
  console.log("Page text contains 'certified':", modalText.includes("certified"));
  console.log("Page text contains 'missing':", modalText.includes("missing"));
  console.log("Page text contains 'Needs':", modalText.includes("Needs"));

  // Find all banners
  const banners = await page.locator(".banner").all();
  console.log("Banners found:", banners.length);
  for (const b of banners) {
    const txt = await b.textContent().catch(() => "");
    console.log("  Banner:", txt?.trim().slice(0, 150));
  }

  // Find all selects and their options
  const selects = await page.locator("select").all();
  console.log("Selects found:", selects.length);
  for (const sel of selects) {
    const opts = await sel.locator("option").all();
    for (const opt of opts) {
      const txt = await opt.textContent().catch(() => "");
      const val = await opt.getAttribute("value").catch(() => "");
      console.log(`  Option: val="${val}" txt="${txt?.trim()}"`);
    }
  }

  // Take a full page screenshot
  await page.screenshot({ path: `${DIR}/t6-modal-03-fullpage.png`, fullPage: true });

  // Scroll down to find banners
  await page.evaluate(() => window.scrollBy(0, 300));
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${DIR}/t6-modal-04-scrolled.png` });
  console.log("Modal scrolled:", `${DIR}/t6-modal-04-scrolled.png`);

  // Look for specific banner text patterns (T5 skill hint)
  const skillBanners = page.locator(".banner").filter({ hasText: /[Bb]ackflow|certified|missing|[Nn]eeds/i });
  const skillBannerCount = await skillBanners.count();
  console.log("Skill-related banners:", skillBannerCount);

  if (skillBannerCount > 0) {
    await skillBanners.first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${DIR}/t6-T5-MODAL-MISSING-BANNER.png` });
    console.log("T5 MISSING BANNER:", `${DIR}/t6-T5-MODAL-MISSING-BANNER.png`);
  }

  // Try to switch to qualified tech via Crew select
  const crewSelect = page.locator("select").first();
  if (await crewSelect.count() > 0) {
    const options = await page.locator("select option").all();
    for (const opt of options) {
      const txt2 = await opt.textContent().catch(() => "") ?? "";
      const val = await opt.getAttribute("value").catch(() => "") ?? "";
      // owner user id: 0e69d06e-2442-47c9-8e42-415bbcd0ce55
      if (val.includes("0e69d06e")) {
        await crewSelect.selectOption(val);
        await page.waitForTimeout(1000);
        await page.screenshot({ path: `${DIR}/t6-T5-MODAL-QUALIFIED-BANNER.png` });
        console.log("T5 QUALIFIED BANNER:", `${DIR}/t6-T5-MODAL-QUALIFIED-BANNER.png`);
        break;
      }
    }

    // Also try selecting the option that doesn't have "missing" — the qualified one
    const missingOpts = await page.locator("select option").filter({ hasText: /missing/i }).all();
    const allOpts = await page.locator("select option").all();
    console.log(`Total opts: ${allOpts.length}, missing opts: ${missingOpts.length}`);

    if (missingOpts.length > 0) {
      // Select missing opt to show ⚠ missing state
      const missingVal = await missingOpts[0]?.getAttribute("value").catch(() => "");
      if (missingVal) {
        await crewSelect.selectOption(missingVal);
        await page.waitForTimeout(1000);
        await page.screenshot({ path: `${DIR}/t6-T5-MODAL-MISSING-SELECT.png` });
        console.log("T5 MISSING SELECT:", `${DIR}/t6-T5-MODAL-MISSING-SELECT.png`);

        // Switch back to qualified
        for (const opt of allOpts) {
          const txt3 = await opt.textContent().catch(() => "") ?? "";
          if (!txt3.toLowerCase().includes("missing") && txt3.trim().length > 1) {
            const val3 = await opt.getAttribute("value").catch(() => "") ?? "";
            if (val3 && val3 !== missingVal) {
              await crewSelect.selectOption(val3);
              await page.waitForTimeout(1000);
              await page.screenshot({ path: `${DIR}/t6-T5-MODAL-QUALIFIED-SELECT.png` });
              console.log("T5 QUALIFIED SELECT:", `${DIR}/t6-T5-MODAL-QUALIFIED-SELECT.png`);
              break;
            }
          }
        }
      }
    }
  }

  await page.screenshot({ path: `${DIR}/t6-modal-FINAL.png`, fullPage: true });
});
