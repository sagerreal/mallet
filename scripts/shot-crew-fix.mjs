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
console.log("Logged in");

// navigate to settings / booking
await p.goto(base + "/settings", { waitUntil: "networkidle" });
await p.waitForTimeout(500);
await p.locator('.navitem').filter({ hasText: /^Booking$/ }).click();
await p.waitForTimeout(1000);

// scroll to bottom
await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await p.waitForTimeout(500);

// Open "Crew hours" FoldCard
const crewFhead = p.locator('.fhead').filter({ has: p.locator('h3', { hasText: 'Crew hours' }) });
await crewFhead.click();
await p.waitForTimeout(1000);
console.log("Opened Crew hours card");

// Scroll to make crew section visible
await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await p.waitForTimeout(500);

// Now find crew member rows by their "Business hours" summary text
// The crew row header is a div with cursor:pointer containing the member name
// Try clicking directly by the summary text
const businessHoursSummary = p.locator('span.muted', { hasText: /^Business hours$/ });
const count = await businessHoursSummary.count();
console.log(`Found ${count} "Business hours" summary spans`);

if (count > 0) {
  // Click the container div of the first one
  const firstSummary = businessHoursSummary.first();
  // Get its parent container (the row header div)
  const rowHeader = firstSummary.locator('..');
  await rowHeader.click();
  await p.waitForTimeout(800);
  console.log("Clicked first crew row");

  // Find day mode selects
  const daySelects = p.locator('select').filter({ has: p.locator('option[value="custom"]') });
  const selCount = await daySelects.count();
  console.log(`Found ${selCount} day mode selects`);

  if (selCount > 0) {
    await daySelects.first().selectOption("custom");
    await p.waitForTimeout(400);
    console.log("Set Mon to Custom hours");
  }
  if (selCount > 1) {
    await daySelects.nth(1).selectOption("off");
    await p.waitForTimeout(400);
    console.log("Set Tue to Day off");
  }
}

await p.screenshot({ path: "/tmp/ui-crew.png", fullPage: true });
console.log("shot saved: /tmp/ui-crew.png");
await b.close();
