/**
 * e2e/screenshot-t6-modal2.spec.ts
 * Target JOB-1011 directly: row 6 "Field 1782955864106 Water heater swap Scheduled Fri 8a TE tech $0"
 * This job has required_certs=['Backflow'] and visit assigned to unqualified tech.
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

test("T5+T6 modal banners — target JOB-1011 row (Scheduled, has visit)", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await login(page);

  await page.goto(`${BASE}/jobs?tab=jobs`);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(3000);

  await page.screenshot({ path: `${DIR}/t6-m2-01-list.png` });

  // Find the row that has "Scheduled" + "Water heater swap" + "tech" (JOB-1011)
  // Row 6: "Field 1782955864106Water heater swapScheduledFri 8aTEtech$0"
  const rows = page.locator("main tr");
  const rowCount = await rows.count();
  console.log("Total rows:", rowCount);

  let targetRow = -1;
  for (let i = 1; i < rowCount; i++) {
    const txt = (await rows.nth(i).textContent().catch(() => "")) ?? "";
    if (txt.includes("Water heater swap") && (txt.includes("Scheduled") || txt.includes("Fri") || txt.includes("Jul 17"))) {
      console.log(`Target row ${i}: "${txt.trim().slice(0, 100)}"`);
      targetRow = i;
      break;
    }
  }

  if (targetRow === -1) {
    // fallback: find row with tech in it (assigned to tech user)
    for (let i = 1; i < rowCount; i++) {
      const txt = (await rows.nth(i).textContent().catch(() => "")) ?? "";
      if (txt.includes("tech") && txt.includes("Water heater swap")) {
        console.log(`Fallback row ${i}: "${txt.trim().slice(0, 100)}"`);
        targetRow = i;
        break;
      }
    }
  }

  if (targetRow === -1) {
    console.log("SCREENSHOT_NOTE: Could not find JOB-1011 row. Using row 6.");
    targetRow = 6;
  }

  await page.locator("main tr").nth(targetRow).click({ timeout: 8000 });
  await page.waitForTimeout(2500);

  await page.screenshot({ path: `${DIR}/t6-m2-02-modal.png` });
  console.log("Modal opened at row", targetRow);

  const bodyText = await page.locator("body").textContent().catch(() => "") ?? "";
  console.log("Has Backflow:", bodyText.includes("Backflow"));
  console.log("Has certified:", bodyText.includes("certified"));
  console.log("Has missing:", bodyText.includes("missing"));
  console.log("Has Needs:", bodyText.includes("Needs"));

  const banners = await page.locator(".banner").all();
  for (const b of banners) {
    console.log("Banner:", (await b.textContent().catch(() => ""))?.trim().slice(0, 150));
  }

  const selects = await page.locator("select").all();
  console.log("Selects:", selects.length);
  for (const sel of selects) {
    const opts = await sel.locator("option").all();
    for (const opt of opts) {
      console.log("  Opt:", (await opt.textContent().catch(() => ""))?.trim(), "val:", await opt.getAttribute("value"));
    }
  }

  // Full page screenshot
  await page.screenshot({ path: `${DIR}/t6-m2-03-fullpage.png`, fullPage: true });
  console.log("Full page:", `${DIR}/t6-m2-03-fullpage.png`);

  // Scroll down to find the visit row with banner
  await page.evaluate(() => window.scrollBy(0, 400));
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${DIR}/t6-m2-04-scrolled.png` });

  // Find skill banners
  const skillBanners = page.locator(".banner").filter({ hasText: /Backflow|certified|missing|Needs/i });
  const count = await skillBanners.count();
  console.log("Skill banners:", count);

  if (count > 0) {
    await skillBanners.first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${DIR}/t6-T5-skill-banner.png` });
    console.log("T5 SKILL BANNER:", `${DIR}/t6-T5-skill-banner.png`);

    // Now try to change crew to qualified (owner)
    const crewSelect = page.locator("select").first();
    if (await crewSelect.count() > 0) {
      // Find owner option
      const allOpts = await crewSelect.locator("option").all();
      for (const opt of allOpts) {
        const txt = (await opt.textContent().catch(() => "")) ?? "";
        // Owner user id: 0e69d06e-2442-47c9-8e42-415bbcd0ce55
        const val = (await opt.getAttribute("value").catch(() => "")) ?? "";
        if (val.startsWith("0e69d06e") || txt.toLowerCase().includes("owner") || (!txt.toLowerCase().includes("missing") && !txt.toLowerCase().includes("unassigned") && val)) {
          console.log("Switching to option:", txt.trim(), val);
          await crewSelect.selectOption(val);
          await page.waitForTimeout(1000);
          await page.screenshot({ path: `${DIR}/t6-T5-qualified-select.png` });
          console.log("T5 qualified after select:", `${DIR}/t6-T5-qualified-select.png`);
          break;
        }
      }
    }
  }

  await page.screenshot({ path: `${DIR}/t6-m2-FINAL.png`, fullPage: true });
});
