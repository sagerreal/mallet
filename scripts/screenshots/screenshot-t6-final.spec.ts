/**
 * e2e/screenshot-t6-final.spec.ts
 * Final T6 screenshot capture with corrected board scrolling and placement logic.
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

test("T6-FINAL-step2 — armed board full-page: banner + dim + missing note", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await login(page);

  await page.goto(`${BASE}/jobs?tab=schedule`);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(3000);

  // Arm JOB-1011 (first "Water heater swap" card = Field 1782955864106)
  const whCards = page.locator(".railjob").filter({ hasText: "Water heater swap" });
  const wh0 = whCards.first();
  const btn = wh0.getByRole("button", { name: "Schedule" });
  if (await btn.count() > 0) {
    await btn.click();
    await page.waitForTimeout(1500);
  } else {
    await page.getByRole("button", { name: "Schedule" }).first().click();
    await page.waitForTimeout(1500);
  }

  // Full-page screenshot with armed banner + board
  await page.screenshot({ path: `${DIR}/t6-STEP2-armed-fullpage.png`, fullPage: true });
  console.log("STEP2 full page:", `${DIR}/t6-STEP2-armed-fullpage.png`);

  // Verify annotations
  const dimCount = await page.locator(".cert-dim").count();
  const missingCount = await page.locator(".cert-missing").count();
  console.log(`STEP2: cert-dim=${dimCount}, cert-missing=${missingCount}`);

  // Scroll so both crew rows and the banner are visible, then viewport screenshot
  const banner = page.locator("div").filter({ hasText: /Tap a crew & time/ }).locator("span").first();
  if (await banner.count() > 0) {
    await banner.scrollIntoViewIfNeeded();
  }
  await page.evaluate(() => window.scrollBy(0, 400));
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${DIR}/t6-STEP2-armed-board-view.png` });
  console.log("STEP2 board view:", `${DIR}/t6-STEP2-armed-board-view.png`);
});

test("T6-FINAL-step3 — no-certified-crew state", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await login(page);

  // Remove cert
  await page.goto(`${BASE}/settings`);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(2500);

  // Screenshot settings before
  await page.screenshot({ path: `${DIR}/t6-STEP3-settings-with-cert.png`, fullPage: true });

  // Click the ✕ on the Backflow chip
  const removeBtn = page.locator("button").filter({ hasText: "✕" }).first();
  if (await removeBtn.count() > 0) {
    await removeBtn.click();
    await page.waitForTimeout(600);
    console.log("Removed Backflow cert chip");
  }

  // Save
  const saveBtn = page.getByRole("button", { name: /^save$/i }).first();
  if (await saveBtn.count() > 0) {
    await saveBtn.click();
    await page.waitForTimeout(1500);
  }

  await page.screenshot({ path: `${DIR}/t6-STEP3-settings-cert-removed.png`, fullPage: true });

  // Go to board and arm the Water heater swap job
  await page.goto(`${BASE}/jobs?tab=schedule`);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(2500);

  const whCards = page.locator(".railjob").filter({ hasText: "Water heater swap" });
  if (await whCards.count() > 0) {
    const btn = whCards.first().getByRole("button", { name: "Schedule" });
    if (await btn.count() > 0) {
      await btn.click();
    }
  } else {
    await page.getByRole("button", { name: "Schedule" }).first().click();
  }
  await page.waitForTimeout(1500);

  await page.screenshot({ path: `${DIR}/t6-STEP3-no-certified-crew-fullpage.png`, fullPage: true });
  console.log("STEP3 no-crew:", `${DIR}/t6-STEP3-no-certified-crew-fullpage.png`);

  const dimCount = await page.locator(".cert-dim").count();
  console.log(`STEP3: cert-dim=${dimCount} (expect 2 — both lanes dim)`);

  // Re-add cert
  await page.goto(`${BASE}/settings`);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(2000);

  const certInput = page.getByPlaceholder("Add certification");
  if (await certInput.count() > 0) {
    await certInput.fill("Backflow");
    await certInput.press("Enter");
    await page.waitForTimeout(800);
    const saveBtn2 = page.getByRole("button", { name: /^save$/i }).first();
    if (await saveBtn2.count() > 0) {
      await saveBtn2.click();
      await page.waitForTimeout(1500);
    }
    console.log("Re-added Backflow cert");
  }
  await page.screenshot({ path: `${DIR}/t6-STEP3-cert-readded.png`, fullPage: true });
});

test("T6-FINAL-step4 — place visit + open modal for T5 banners", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await login(page);

  // Navigate to tomorrow's date so there are no existing blocks in the cell
  await page.goto(`${BASE}/jobs?tab=schedule`);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(2500);

  // Navigate to Next day to get a clean board
  await page.getByRole("button", { name: /next/i }).first().click();
  await page.waitForTimeout(1000);

  await page.screenshot({ path: `${DIR}/t6-STEP4-board-next-day.png`, fullPage: true });

  // Arm the Water heater swap job
  const whCards = page.locator(".railjob").filter({ hasText: "Water heater swap" });
  if (await whCards.count() > 0) {
    const btn = whCards.first().getByRole("button", { name: "Schedule" });
    if (await btn.count() > 0) {
      await btn.click();
      await page.waitForTimeout(1200);
      console.log("Armed Water heater swap for next day");
    }
  }

  await page.screenshot({ path: `${DIR}/t6-STEP4-armed-nextday.png`, fullPage: true });

  // Now tap a drop cell (should be empty on next day)
  const dropCells = page.locator(".gv-cell.drop");
  const cellCount = await dropCells.count();
  console.log("Drop cells on next day:", cellCount);

  if (cellCount > 0) {
    // Try clicking the first drop cell with force
    await dropCells.first().click({ force: true });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${DIR}/t6-STEP4-visit-placed.png`, fullPage: true });
    console.log("STEP4 visit placed:", `${DIR}/t6-STEP4-visit-placed.png`);
  }

  // Now open job modal — go to jobs list and find the water heater swap row
  await page.goto(`${BASE}/jobs?tab=jobs`);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(2500);

  await page.screenshot({ path: `${DIR}/t6-STEP4-jobs-list.png` });

  // Click the Water heater swap row
  const whRow = page.locator("main tr").filter({ hasText: "Water heater swap" }).first();
  if (await whRow.count() > 0) {
    await whRow.click({ timeout: 8000 });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${DIR}/t6-STEP4-modal-open.png` });
    console.log("STEP4 modal open:", `${DIR}/t6-STEP4-modal-open.png`);

    // Check for banners
    const banners = await page.locator(".banner").all();
    for (const b of banners) {
      const txt = await b.textContent().catch(() => "");
      console.log("Banner text:", txt?.trim().slice(0, 120));
    }

    // Check for missing/qualified keywords in the banner
    const qualifiedBanner = page.locator(".banner").filter({ hasText: /certified|is certified/i });
    const needsBanner = page.locator(".banner").filter({ hasText: /[Nn]eeds|missing/i });

    if (await qualifiedBanner.count() > 0) {
      await qualifiedBanner.first().scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${DIR}/t6-STEP4-T5-qualified.png` });
      console.log("T5 qualified screenshot:", `${DIR}/t6-STEP4-T5-qualified.png`);
    }

    if (await needsBanner.count() > 0) {
      await needsBanner.first().scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${DIR}/t6-STEP4-T5-needs.png` });
      console.log("T5 needs/missing screenshot:", `${DIR}/t6-STEP4-T5-needs.png`);
    }

    // Try to switch crew to unqualified (tech, no Backflow) via the select
    const selects = await page.locator("select").all();
    console.log("Number of selects:", selects.length);

    for (const sel of selects) {
      const opts = await sel.locator("option").all();
      const optTexts = await Promise.all(opts.map((o) => o.textContent()));
      console.log("Select options:", optTexts.map((t) => t?.trim()));

      // Look for unqualified option (has "missing" text)
      const missingOpt = opts.find(async (o) => (await o.textContent() ?? "").includes("missing"));
      if (missingOpt) {
        const val = await missingOpt.getAttribute("value");
        if (val) {
          await sel.selectOption(val);
          await page.waitForTimeout(1000);
          await page.screenshot({ path: `${DIR}/t6-STEP4-T5-missing.png` });
          console.log("T5 missing screenshot:", `${DIR}/t6-STEP4-T5-missing.png`);
          break;
        }
      }

      // Also try: look for option texts with "missing" keyword
      for (let i = 0; i < optTexts.length; i++) {
        if ((optTexts[i] ?? "").toLowerCase().includes("missing")) {
          const val = await opts[i]?.getAttribute("value");
          if (val) {
            await sel.selectOption(val);
            await page.waitForTimeout(1000);
            await page.screenshot({ path: `${DIR}/t6-STEP4-T5-missing.png` });
            console.log("T5 missing screenshot:", `${DIR}/t6-STEP4-T5-missing.png`);
            break;
          }
        }
      }
    }

    // Scroll to see the full modal
    await page.screenshot({ path: `${DIR}/t6-STEP4-modal-final.png`, fullPage: true });
  } else {
    console.log("SCREENSHOT_NOTE: Could not find Water heater swap row in jobs list.");
    await page.screenshot({ path: `${DIR}/t6-STEP4-no-row.png`, fullPage: true });
  }
});
