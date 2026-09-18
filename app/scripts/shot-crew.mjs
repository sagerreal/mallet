import { chromium } from "@playwright/test";
import { OWNER } from "./e2e-credentials.mjs";
const base = "http://localhost:3210";

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1512, height: 950 } });

// Login
await p.goto(base + "/login", { waitUntil: "networkidle" });
await p.getByLabel("Email").fill(OWNER.email);
await p.getByLabel("Password").fill(OWNER.password);
await p.getByRole("button", { name: "Sign in" }).click();
await p.waitForURL("**/dashboard", { timeout: 30000 });

// Navigate to settings
await p.goto(base + "/settings", { waitUntil: "networkidle" });
await p.waitForTimeout(2000);

// Click the Booking tab
const bookingTab = p.getByRole("button", { name: "Booking" });
if (await bookingTab.isVisible()) {
  await bookingTab.click();
} else {
  await p.getByText("Booking", { exact: true }).first().click();
}
await p.waitForTimeout(1500);

// Screenshot 1: Booking tab visible (crew hours card collapsed at bottom)
await p.screenshot({ path: "/tmp/crew-shot-1-booking-collapsed.png", fullPage: true });
console.log("shot 1 saved: /tmp/crew-shot-1-booking-collapsed.png");

// Expand the "Crew hours" FoldCard by clicking its fhead
await p.getByText("Crew hours").first().click();
await p.waitForTimeout(1000);

// Scroll to bring it into view and screenshot
await p.evaluate(() => {
  const cards = document.querySelectorAll('.foldcard.open');
  const last = cards[cards.length - 1];
  if (last) last.scrollIntoView({ behavior: 'instant', block: 'start' });
});
await p.waitForTimeout(500);

// Screenshot 2: Crew hours card expanded (crew list or empty state)
await p.screenshot({ path: "/tmp/crew-shot-2-crew-hours-expanded.png", fullPage: true });
console.log("shot 2 saved: /tmp/crew-shot-2-crew-hours-expanded.png");

// Find the Crew hours foldcard specifically by its heading text
// Then find clickable rows inside its body
const crewHoursFoldcard = p.locator('.foldcard').filter({ has: p.locator('h3', { hasText: 'Crew hours' }) });
const crewRowDivs = crewHoursFoldcard.locator('[style*="cursor: pointer"]');
const count = await crewRowDivs.count();
console.log(`Found ${count} crew row expand divs in Crew hours card`);

if (count > 0) {
  // Force click to bypass visibility issues
  await crewRowDivs.first().click({ force: true });
  await p.waitForTimeout(1200);

  // Scroll to the crew card
  await crewHoursFoldcard.scrollIntoViewIfNeeded();
  await p.waitForTimeout(400);

  // Screenshot 3: First crew row expanded showing weekday editors
  await p.screenshot({ path: "/tmp/crew-shot-3-crew-row-expanded.png", fullPage: true });
  console.log("shot 3 saved: /tmp/crew-shot-3-crew-row-expanded.png");
} else {
  console.log("No crew rows to expand (no field crew in this org)");
}

await b.close();
