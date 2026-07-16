/**
 * e2e/screenshot-t6-focused.spec.ts
 * Focused T6 screenshots — JOB-1011 is now in the tray with required_certs=['Backflow'].
 * owner@e2e.mallet.test has Backflow cert; tech@e2e.mallet.test does not.
 *
 * Step 2: Arm JOB-1011 → see armed banner phrase + cert-dim on unqualified lane
 * Step 3: View no-certified-crew state (cert temporarily removed from owner)
 * Step 4: Place on qualified tech → open modal → T5 banners
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

test("T6-step2-certified — armed banner phrase + dimmed lane (owner has Backflow)", async ({ page }) => {
  await login(page);

  await page.goto(`${BASE}/jobs?tab=schedule`);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(3000);

  console.log("=== Step 2: Looking for JOB-1011 (Water heater swap, required_certs=Backflow) ===");

  // Find JOB-1011 in the tray — it has title "Water heater swap"
  // Look for tray cards
  const trayCards = page.locator(".railjob");
  const cardCount = await trayCards.count();
  console.log("Tray cards:", cardCount);

  // List all tray cards
  for (let i = 0; i < cardCount; i++) {
    const txt = (await trayCards.nth(i).textContent().catch(() => "")) ?? "";
    console.log(`  Card ${i}: "${txt.trim().slice(0, 80)}"`);
  }

  await page.screenshot({ path: `${DIR}/t6-step2-01-tray.png`, fullPage: true });

  // Find the "Water heater swap" job card (JOB-1011)
  const waterHeaterCards = trayCards.filter({ hasText: "Water heater swap" });
  const whCount = await waterHeaterCards.count();
  console.log("Water heater swap cards:", whCount);

  // Try to find and click its Schedule button
  let armed = false;
  if (whCount > 0) {
    const schedBtn = waterHeaterCards.first().getByRole("button", { name: "Schedule" });
    if (await schedBtn.count() > 0) {
      await schedBtn.click();
      await page.waitForTimeout(1500);
      armed = true;
      console.log("Armed JOB-1011 (Water heater swap)");
    }
  }

  if (!armed) {
    // Fallback: arm the first available Schedule button in any card
    const allSchedule = page.getByRole("button", { name: "Schedule" });
    const allCount = await allSchedule.count();
    console.log(`Fallback: ${allCount} Schedule buttons available`);
    if (allCount > 0) {
      await allSchedule.first().click();
      await page.waitForTimeout(1500);
      armed = true;
    }
  }

  if (armed) {
    await page.screenshot({ path: `${DIR}/t6-step2-02-armed-banner.png`, fullPage: true });
    console.log("Screenshot:", `${DIR}/t6-step2-02-armed-banner.png`);

    // Inspect banner text
    const bannerEls = page.locator("div").filter({ hasText: /Tap a crew/ }).first();
    const bannerText = await bannerEls.textContent().catch(() => "");
    console.log("Banner text:", bannerText?.trim().slice(0, 200));

    // Check cert annotations
    const dimmedLanes = await page.locator(".cert-dim").count();
    const missingNotes = await page.locator(".cert-missing").count();
    console.log(`cert-dim lanes: ${dimmedLanes}, cert-missing notes: ${missingNotes}`);

    // Scroll down to see the board fully
    await page.evaluate(() => window.scrollBy(0, 300));
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${DIR}/t6-step2-03-armed-board-scrolled.png`, fullPage: true });
    console.log("Scrolled board screenshot:", `${DIR}/t6-step2-03-armed-board-scrolled.png`);
  } else {
    console.log("SCREENSHOT_NOTE: Could not arm a job. JOB-1011 may not be in tray.");
    await page.screenshot({ path: `${DIR}/t6-step2-FAILED-no-arm.png`, fullPage: true });
  }
});

test("T6-step3-no-crew — armed banner: no certified crew", async ({ page }) => {
  await login(page);

  // First remove the Backflow cert from owner via settings
  await page.goto(`${BASE}/settings`);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(2500);

  // Find the Backflow chip's ✕ button and click it
  const backflowChipX = page.locator("button").filter({ hasText: "×" }).first();
  const chipRemoveLocators = [
    page.locator("[class*='chip'] button, [class*='tag'] button").filter({ hasText: /×|✕|x/i }).first(),
    page.locator("span").filter({ hasText: "Backflow" }).locator("~ button, button").first(),
    page.locator(".cert-chip button, .skill-chip button").first(),
    // The chip pattern from T2: likely a span with a ✕ inside
    page.locator("span").filter({ hasText: "✕" }).first(),
    backflowChipX,
  ];

  let certRemoved = false;
  for (const loc of chipRemoveLocators) {
    if (await loc.count() > 0) {
      const txt = await loc.textContent().catch(() => "");
      console.log("Found remove button text:", txt?.trim());
      await loc.click();
      await page.waitForTimeout(800);
      certRemoved = true;
      break;
    }
  }

  if (!certRemoved) {
    // Try to find the Backflow text and look for adjacent ✕
    const backflowText = page.locator("text=Backflow");
    if (await backflowText.count() > 0) {
      // Click the parent element and look for a remove control
      const parent = backflowText.locator("xpath=../..");
      const xBtn = parent.locator("button, span[role='button']").first();
      if (await xBtn.count() > 0) {
        await xBtn.click();
        await page.waitForTimeout(800);
        certRemoved = true;
      }
    }
  }

  console.log("Cert removed?", certRemoved);

  // Save if there's a save button
  const saveBtn = page.getByRole("button", { name: /save/i }).filter({ hasText: /^save$/i }).first();
  if (await saveBtn.count() > 0) {
    await saveBtn.click();
    await page.waitForTimeout(1500);
    console.log("Saved after cert removal");
  }

  await page.screenshot({ path: `${DIR}/t6-step3-01-settings-cert-removed.png`, fullPage: true });

  // Now arm the board
  await page.goto(`${BASE}/jobs?tab=schedule`);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(2500);

  const schedBtns = page.getByRole("button", { name: "Schedule" });
  const btnCount = await schedBtns.count();
  console.log("Schedule buttons for no-crew test:", btnCount);

  // Try water heater swap first (JOB-1011)
  const whCards = page.locator(".railjob").filter({ hasText: "Water heater swap" });
  if (await whCards.count() > 0) {
    const btn = whCards.first().getByRole("button", { name: "Schedule" });
    if (await btn.count() > 0) {
      await btn.click();
    } else if (btnCount > 0) {
      await schedBtns.first().click();
    }
  } else if (btnCount > 0) {
    await schedBtns.first().click();
  }

  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${DIR}/t6-step3-02-no-certified-crew.png`, fullPage: true });

  const bannerEls = page.locator("div").filter({ hasText: /Tap a crew/ }).first();
  const bannerText = await bannerEls.textContent().catch(() => "");
  console.log("No-crew banner text:", bannerText?.trim().slice(0, 200));

  const dimmedLanes = await page.locator(".cert-dim").count();
  console.log("cert-dim lanes:", dimmedLanes);

  // Re-add the Backflow cert to owner
  await page.goto(`${BASE}/settings`);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(2000);

  const certInput = page.getByPlaceholder("Add certification").first();
  if (await certInput.count() > 0) {
    await certInput.fill("Backflow");
    await certInput.press("Enter");
    await page.waitForTimeout(800);
    const saveCertBtn = page.getByRole("button", { name: /save/i }).filter({ hasText: /^save$/i }).first();
    if (await saveCertBtn.count() > 0) {
      await saveCertBtn.click();
      await page.waitForTimeout(1500);
    }
    console.log("Re-added Backflow cert");
    await page.screenshot({ path: `${DIR}/t6-step3-03-cert-readded.png`, fullPage: true });
  }
});

test("T6-step4-place — place visit + T5 modal banners", async ({ page }) => {
  await login(page);

  // Arm JOB-1011 (Water heater swap with Backflow requirement)
  await page.goto(`${BASE}/jobs?tab=schedule`);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(3000);

  // Find and arm the water heater swap job
  const whCards = page.locator(".railjob").filter({ hasText: "Water heater swap" });
  const whCount = await whCards.count();
  console.log("=== Step 4: Water heater swap cards in tray:", whCount);

  if (whCount > 0) {
    const schedBtn = whCards.first().getByRole("button", { name: "Schedule" });
    if (await schedBtn.count() > 0) {
      await schedBtn.click();
      await page.waitForTimeout(1000);
      console.log("Armed JOB-1011");

      // Scroll to board
      await page.evaluate(() => window.scrollBy(0, 500));
      await page.waitForTimeout(500);

      // Click a drop cell in the FIRST crew row (owner who has Backflow)
      const dropCells = page.locator(".gv-cell.drop");
      const cellCount = await dropCells.count();
      console.log("Drop cells:", cellCount);

      if (cellCount > 0) {
        await dropCells.first().click();
        await page.waitForTimeout(2000);
        await page.screenshot({ path: `${DIR}/t6-step4-01-visit-placed.png`, fullPage: true });
        console.log("Visit placed:", `${DIR}/t6-step4-01-visit-placed.png`);
      }
    }
  } else {
    // Just use any available Schedule button
    const anySchedule = page.getByRole("button", { name: "Schedule" });
    if (await anySchedule.count() > 0) {
      await anySchedule.first().click();
      await page.waitForTimeout(800);
      const cells = page.locator(".gv-cell.drop");
      if (await cells.count() > 0) {
        await cells.first().click();
        await page.waitForTimeout(1500);
      }
    }
    await page.screenshot({ path: `${DIR}/t6-step4-01-fallback-placed.png`, fullPage: true });
  }

  // Now open the job modal for JOB-1011 via the jobs list
  await page.goto(`${BASE}/jobs?tab=jobs`);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(2500);

  await page.screenshot({ path: `${DIR}/t6-step4-02-jobs-list.png` });

  // Look for a row containing "Water heater swap"
  const rows = page.locator("main tr");
  const rowCount = await rows.count();
  console.log("Job rows:", rowCount);

  for (let i = 0; i < rowCount; i++) {
    const txt = (await rows.nth(i).textContent().catch(() => "")) ?? "";
    console.log(`  Row ${i}: "${txt.trim().slice(0, 80)}"`);
  }

  // Click the "Water heater swap" row
  const whRow = page.locator("main tr").filter({ hasText: "Water heater swap" }).first();
  const whRowCount = await whRow.count();
  console.log("Water heater row found:", whRowCount > 0);

  if (whRowCount > 0) {
    await whRow.click({ timeout: 5000 });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${DIR}/t6-step4-03-modal-open.png` });

    // Look for skill banners and crew select
    const allBanners = await page.locator(".banner").all();
    for (const b of allBanners) {
      const txt2 = await b.textContent().catch(() => "");
      console.log("Banner:", txt2?.trim().slice(0, 120));
    }

    const allOpts = await page.locator("select option").all();
    for (const o of allOpts) {
      const txt2 = await o.textContent().catch(() => "");
      console.log("Option:", txt2?.trim().slice(0, 60));
    }

    // Check for qualified banner (green check / certified)
    const qualifiedBanner = page.locator(".banner").filter({ hasText: /certified|qualified/i });
    if (await qualifiedBanner.count() > 0) {
      await qualifiedBanner.first().scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${DIR}/t6-step4-04-t5-qualified-banner.png` });
      console.log("T5 qualified banner:", `${DIR}/t6-step4-04-t5-qualified-banner.png`);
    }

    // Needs banner
    const needsBanner = page.locator(".banner").filter({ hasText: /[Nn]eeds|missing/i });
    if (await needsBanner.count() > 0) {
      await needsBanner.first().scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${DIR}/t6-step4-04b-t5-needs-banner.png` });
      console.log("T5 needs banner:", `${DIR}/t6-step4-04b-t5-needs-banner.png`);
    }

    // Now switch crew to unqualified tech (tech@e2e.mallet.test, no Backflow)
    const crewSelect = page.locator("select").first();
    if (await crewSelect.count() > 0) {
      // Get options
      const allOptTexts = await Promise.all(
        (await page.locator("select option").all()).map((o) => o.textContent()),
      );
      console.log("All crew options:", allOptTexts);

      // Find unqualified option (has "missing" text)
      const missingOpt = page.locator("select option").filter({ hasText: /missing/i });
      const missingCount = await missingOpt.count();
      console.log("Missing options:", missingCount);

      if (missingCount > 0) {
        const missingVal = await missingOpt.first().getAttribute("value");
        if (missingVal) {
          await crewSelect.selectOption(missingVal);
          await page.waitForTimeout(1000);
          await page.screenshot({ path: `${DIR}/t6-step4-05-t5-missing-banner.png` });
          console.log("T5 missing banner:", `${DIR}/t6-step4-05-t5-missing-banner.png`);
        }
      } else {
        // Try selecting any different option
        const opts = await page.locator("select option").all();
        if (opts.length > 1) {
          const secondVal = await opts[1]?.getAttribute("value");
          if (secondVal) {
            await crewSelect.selectOption(secondVal);
            await page.waitForTimeout(1000);
            await page.screenshot({ path: `${DIR}/t6-step4-05-crew-changed.png` });
          }
        }
      }
    }
  } else {
    // Try first job row
    if (rowCount > 1) {
      await page.locator("main tr").nth(1).click({ timeout: 5000 });
      await page.waitForTimeout(2000);
      await page.screenshot({ path: `${DIR}/t6-step4-03-modal-fallback.png` });
    }
    console.log("SCREENSHOT_NOTE Step 4: Water heater row not found in job list.");
  }
});
