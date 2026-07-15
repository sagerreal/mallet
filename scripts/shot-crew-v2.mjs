import { chromium } from "@playwright/test";

const PORT = process.env.PORT ?? "3001";
const base = `http://localhost:${PORT}`;

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1512, height: 950 } });

// login
await p.goto(base + "/login", { waitUntil: "networkidle" });
await p.getByLabel("Email").fill("owner@e2e.mallet.test");
await p.getByLabel("Password").fill("e2e-password-1");
await p.getByRole("button", { name: "Sign in" }).click();
await p.waitForURL("**/dashboard", { timeout: 30000 });

// navigate to settings / booking
await p.goto(base + "/settings", { waitUntil: "networkidle" });
await p.waitForTimeout(500);
await p.locator('.navitem').filter({ hasText: /^Booking$/ }).click();
await p.waitForTimeout(1000);

// scroll to bottom and open Crew hours card
await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await p.waitForTimeout(300);

const crewFhead = p.locator('.fhead').filter({ has: p.locator('h3', { hasText: 'Crew hours' }) });
await crewFhead.click();
await p.waitForTimeout(1000);

// Scroll so crew section is visible
await crewFhead.scrollIntoViewIfNeeded();
await p.waitForTimeout(500);

// Find the crew member header by "Business hours" text and click its parent
const businessHoursEl = p.locator('span.muted', { hasText: /^Business hours$/ }).first();
const rowHeaderEl = businessHoursEl.locator('..');
await rowHeaderEl.scrollIntoViewIfNeeded();
await rowHeaderEl.click();
await p.waitForTimeout(800);
console.log("Clicked crew member row");

// Set day modes
const daySelects = p.locator('select').filter({ has: p.locator('option[value="custom"]') });
const count = await daySelects.count();
console.log(`Found ${count} day selects`);

if (count > 0) {
  await daySelects.first().selectOption("custom");
  await p.waitForTimeout(400);
}
if (count > 1) {
  await daySelects.nth(1).selectOption("off");
  await p.waitForTimeout(400);
}

// Scroll to the crew section for the screenshot
await crewFhead.scrollIntoViewIfNeeded();
await p.waitForTimeout(400);

// Take a screenshot cropped to just the viewport (not fullPage) so we see the crew area
await p.screenshot({ path: "/tmp/ui-crew.png", fullPage: false });
console.log("shot saved: /tmp/ui-crew.png");
await b.close();
