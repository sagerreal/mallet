/**
 * Screenshot script for task 1A.3 — Checklists tab
 * Seeds plumbing starters (if needed), then captures list, editor, starter modal.
 */
import { chromium } from "@playwright/test";

const base = "http://localhost:3001";

async function login(page) {
  await page.goto(base + "/login", { waitUntil: "networkidle" });
  await page.getByLabel("Email").fill("owner@e2e.mallet.test");
  await page.getByLabel("Password").fill("e2e-password-1");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/dashboard", { timeout: 30000 });
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1512, height: 950 } });

await login(page);
await page.goto(base + "/jobs?tab=checklists", { waitUntil: "networkidle" });
await page.waitForTimeout(1500);

// Count existing checklists
const rowCount = await page.locator('button').filter({ hasText: /steps/ }).count();
console.log("existing checklist rows:", rowCount);

// Seed plumbing starters if fewer than 3 checklists
if (rowCount < 3) {
  console.log("Seeding plumbing starters...");
  await page.getByRole("button", { name: "Starter checklists" }).click();
  await page.waitForTimeout(600);
  // Capture starter modal
  await page.screenshot({ path: "/tmp/1A3-starter.png", fullPage: false });
  console.log("shot saved: /tmp/1A3-starter.png");
  // Click Add N checklists
  const addBtn = page.getByRole("button", { name: /Add \d+ checklist/ });
  if (await addBtn.isVisible()) {
    await addBtn.click();
    await page.waitForTimeout(2000);
    // Navigate back to checklists tab
    await page.goto(base + "/jobs?tab=checklists", { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
  } else {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
  }
} else {
  // Just capture starter modal for reference
  await page.getByRole("button", { name: "Starter checklists" }).click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: "/tmp/1A3-starter.png", fullPage: false });
  console.log("shot saved: /tmp/1A3-starter.png");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
}

// 2) List view — now with multiple checklists
await page.screenshot({ path: "/tmp/1A3-list.png", fullPage: false });
console.log("shot saved: /tmp/1A3-list.png");

// 3) Editor — click a checklist row button (filter by "steps" text)
const checklistRow = page.locator('button').filter({ hasText: /steps/ }).first();
if (await checklistRow.isVisible()) {
  await checklistRow.click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: "/tmp/1A3-editor.png", fullPage: false });
  console.log("shot saved: /tmp/1A3-editor.png");
} else {
  console.log("WARNING: No checklist row found for editor shot");
}

await browser.close();
console.log("Done.");
