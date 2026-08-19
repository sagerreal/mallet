// Throwaway visual verification for the composer depth feature (deleted before PR).
// Logs in as the E2E owner, opens /composer, exercises scope + sub-items + the $ chip,
// and screenshots each state for eyeball review.
import { chromium } from "@playwright/test";

const BASE = process.env.BASE ?? "http://localhost:3111";
const OUT = process.env.OUT ?? "/tmp/composer-depth";
const OWNER = {
  email: process.env.E2E_OWNER_EMAIL ?? "owner@e2e.mallet.test",
  password: process.env.E2E_OWNER_PASSWORD ?? "e2e-password-1",
};

const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1440, height: 950 } });

await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await page.fill('input[type="email"]', OWNER.email);
await page.fill('input[type="password"]', OWNER.password);
await page.click('button[type="submit"]');
await page.waitForURL(/dashboard|pipeline|home|today/i, { timeout: 30_000 }).catch(() => {});
await page.waitForTimeout(1500);

await page.goto(`${BASE}/composer`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);

// Fill the first line description so the hints appear.
const desc = page.locator('input[aria-label="Description, line 1"]');
await desc.fill("New Construction Interior Painting");
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}-1-hints.png`, fullPage: true });

// Open the scope editor and type multi-paragraph scope.
await page.getByRole("button", { name: "¶ Add scope" }).click();
await page
  .locator('textarea[aria-label="Scope, line 1"]')
  .fill(
    "Includes:\n1. New drywall walls throughout the basement — bourbon room, office, family room.\n2. Open ceiling joists sprayed flat-black dryfall.\n3. All baseboards, door & window casings.\n\nExcludes: unfinished areas, stairwell hallway, cabinetry, priming.\n\nProducts & sheen: SW Superpaint Velvet ×2 (Agreeable Gray); ceilings Promar 200 Flat ×2.",
  );
await page.waitForTimeout(300);

// Open sub-items and build the roll-up.
await page.getByRole("button", { name: "↳ Add sub-items" }).click();
const fillSub = async (n, d, q, unit, amt) => {
  await page.locator(`input[aria-label="Sub-item ${n} description, line 1"]`).fill(d);
  await page.locator(`input[aria-label="Sub-item ${n} quantity, line 1"]`).fill(String(q));
  await page.locator(`input[aria-label="Sub-item ${n} unit, line 1"]`).fill(unit);
  await page.locator(`input[aria-label="Sub-item ${n} amount, line 1"]`).fill(String(amt));
};
await fillSub(1, "Walls & ceilings — 2 coats, all rooms", 2400, "sq ft", 9840);
await page.getByRole("button", { name: "+ Add sub-item" }).click();
await fillSub(2, "Trim, casings & doors — stain or paint", 62, "pieces", 7430);
await page.getByRole("button", { name: "+ Add sub-item" }).click();
await fillSub(3, "Setup, masking & cleanup", 2, "days", 1570);
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}-2-depth-open.png`, fullPage: true });

// Toggle the $ chip to 'one total'.
await page.getByRole("button", { name: /Customer sees every price/ }).click();
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}-3-total-only.png`, fullPage: true });

await b.close();
console.log("done");
