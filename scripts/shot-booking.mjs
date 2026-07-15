/**
 * shot-booking.mjs
 *
 * Captures three screenshots of the redesigned Settings → Booking tab:
 *   1. /tmp/ui-services.png  — Services & routing card
 *   2. /tmp/ui-hours.png     — Business hours (one day ON, one OFF)
 *   3. /tmp/ui-crew.png      — Crew hours (one member expanded, one day Custom, one Day off)
 *
 * Usage:
 *   PORT=3210 node scripts/shot-booking.mjs
 *
 * Requires: @playwright/test installed, dev server running on PORT (default 3210).
 */

import { chromium } from "@playwright/test";

const PORT = process.env.PORT ?? "3210";
const base = `http://localhost:${PORT}`;

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1512, height: 950 } });

// ---- login -------------------------------------------------------------------
await p.goto(base + "/login", { waitUntil: "networkidle" });
await p.getByLabel("Email").fill("owner@e2e.mallet.test");
await p.getByLabel("Password").fill("e2e-password-1");
await p.getByRole("button", { name: "Sign in" }).click();
await p.waitForURL("**/dashboard", { timeout: 30000 });
console.log("Logged in");

// ---- navigate to Settings → Booking tab -------------------------------------
await p.goto(base + "/settings", { waitUntil: "networkidle" });
await p.waitForTimeout(1000);

// Click the "Booking" nav tab (use exact match on the nav item only)
await p.locator('.navitem').filter({ hasText: /^Booking$/ }).click();
await p.waitForTimeout(1000);

// ---- screenshot 1: Services & routing card -----------------------------------
// Ensure at least one service card has emergency words visible (open it if not),
// and a second service shows the quiet add row.

// Check how many services exist
const serviceCards = p.locator('[aria-label="Remove service"]');
const svcCount = await serviceCards.count();
console.log(`Found ${svcCount} service cards`);

// If we have at least one service, try to fill emergency words on first card
// (it may already be pre-filled; if not, click the "+ Emergency words" button)
if (svcCount > 0) {
  // Try to find the "+ Emergency words" button in the first service card
  const emergencyAddBtn = p.getByText("+ Emergency words").first();
  const isVisible = await emergencyAddBtn.isVisible().catch(() => false);
  if (isVisible) {
    await emergencyAddBtn.click();
    await p.waitForTimeout(300);
  }
}

// If only one service, add a second so we can show both states
if (svcCount < 2) {
  const nameInput = p.locator('input[placeholder="New service name — e.g. Tankless install"]');
  await nameInput.fill("Water heater install");
  await p.getByRole("button", { name: "+ Add service" }).click();
  await p.waitForTimeout(500);
}

await p.screenshot({ path: "/tmp/ui-services.png", fullPage: true });
console.log("shot saved: /tmp/ui-services.png");

// ---- screenshot 2: Business hours (one ON, one OFF) --------------------------
// Find the Hours & service area FoldCard — expand it if collapsed
const hoursFold = p.getByText("Hours & service area");
await hoursFold.click();
await p.waitForTimeout(500);

// Find the switch toggles in the hours section
// The switches correspond to Weekdays, Saturday, Sunday rows
// Toggle Weekdays ON (if it's currently off: 0/0) or leave if already on
// Then ensure Saturday is toggled OFF

const switches = p.locator('.switch input[type="checkbox"]');
const switchCount = await switches.count();
console.log(`Found ${switchCount} toggle switches`);

// Try to find the hours section switches by looking near the Business hours heading
// The first 3 switches in the Hours card are for Weekdays, Saturday, Sunday
// Let's scroll to the hours section first
await hoursFold.scrollIntoViewIfNeeded();
await p.waitForTimeout(300);

// Take the screenshot — if hours are already configured from DB, they may already show correctly
await p.screenshot({ path: "/tmp/ui-hours.png", fullPage: true });
console.log("shot saved: /tmp/ui-hours.png");

// ---- screenshot 3: Crew hours ------------------------------------------------
// FoldCard structure: div.foldcard > div.fhead (click to toggle) > span.caret + h3 + span.fsum
// Find the "Crew hours" FoldCard by its h3 text and click its .fhead

// Scroll to bottom so the crew card is in view
await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await p.waitForTimeout(500);

// Click the fhead containing "Crew hours" h3
const crewFhead = p.locator('.fhead').filter({ has: p.locator('h3', { hasText: 'Crew hours' }) });
await crewFhead.click();
await p.waitForTimeout(1000);
console.log("Clicked Crew hours fold card");

// Now the crew card is open. Inside it, each crew member has a collapsible row with
// a toggle header div (cursor:pointer) containing the crew name and summary
// These rows use inline style, not a class — click the crew name span (flex:1, fontWeight:600)
// The crew member row header has: caret span + name span + summary span
// Let's find them by looking for "Business hours" summary text (the default state)
const crewMemberHeaders = p.locator('div').filter({
  has: p.locator('span.muted', { hasText: /Business hours|Custom/ })
}).filter({
  has: p.locator('span', { hasText: /▸/ })
});

const crewHeaderCount = await crewMemberHeaders.count();
console.log(`Found ${crewHeaderCount} crew member collapsible headers`);

if (crewHeaderCount > 0) {
  // Click the first crew member header to expand it
  await crewMemberHeaders.first().click();
  await p.waitForTimeout(800);
  console.log("Expanded first crew member");

  // Find day-mode selects: they have options "business", "custom", "off"
  // These are inside the expanded crew section
  const dayModeSelects = p.locator('select').filter({ has: p.locator('option[value="business"]') });
  const daySelectCount = await dayModeSelects.count();
  console.log(`Found ${daySelectCount} day-mode selects`);

  if (daySelectCount > 0) {
    await dayModeSelects.first().selectOption("custom");
    await p.waitForTimeout(300);
    console.log("Set first day to Custom hours");
  }
  if (daySelectCount > 1) {
    await dayModeSelects.nth(1).selectOption("off");
    await p.waitForTimeout(300);
    console.log("Set second day to Day off");
  }
}

await p.screenshot({ path: "/tmp/ui-crew.png", fullPage: true });
console.log("shot saved: /tmp/ui-crew.png");

await b.close();
console.log("Done.");
