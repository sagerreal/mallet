/**
 * scripts/shot-app-store.mjs
 *
 * Captures the App Store screenshot set into docs/app-store/screenshots/.
 *
 *   node scripts/shot-app-store.mjs                        # production
 *   node scripts/shot-app-store.mjs http://localhost:3411   # a local prod build
 *   node scripts/shot-app-store.mjs <base> <outDir>
 *
 * SIZE IS THE WHOLE POINT. App Store Connect takes iPhone 6.9" shots at exactly
 * 1290 x 2796 portrait and rejects anything else at upload. That is a 430 x 932
 * CSS viewport at deviceScaleFactor 3 — the iPhone 16 Pro Max. Do not "fix" either
 * number independently; they multiply.
 *
 * WHY IT SIGNS IN AS THE APPLE REVIEW ORG. The screenshots and the reviewer see the
 * same shop, so a figure in a screenshot is a figure the reviewer can find. The shop
 * is seeded by scripts/seed-app-review-org.mjs; re-run that first if a shot comes
 * back with an empty My day (its jobs are dated relative to the seed run).
 *
 * WHY IT STUBS THE NATIVE PLUGIN. Shot 03 is the "Scan a room" row, which renders only
 * when the MalletRoomScan Capacitor plugin answers available:true — it exists inside
 * the iOS shell and nowhere else, so in a browser the row is correctly absent. The stub
 * installs the same plugin shape the shell injects via WKUserScript, so the shot shows
 * what a LiDAR iPhone genuinely shows. It fakes no scan: captureRoom is never called.
 *
 * Every shot waits on a piece of its own content before firing, because this app paints
 * skeleton rows first and a screenshot of a skeleton is indistinguishable from a broken
 * screen.
 */

import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { OWNER_EMAIL } from "./app-review/shop-data.mjs";

const BASE = process.argv[2]?.startsWith("http") ? process.argv[2] : "https://app.trymallet.com";
const OUT = process.argv[3] ?? "docs/app-store/screenshots";
const PASSWORD = process.env.APP_REVIEW_PASSWORD ?? "Ridgeline-Review-7Q4t!2846";

/** iPhone 6.9" — 430 x 932 CSS px at 3x = 1290 x 2796 device px. */
const VIEWPORT = { width: 430, height: 932 };
const SCALE = 3;

mkdirSync(OUT, { recursive: true });

/** The plugin shape Capacitor injects into the shell's webview. */
const NATIVE_STUB = () => {
  const w = /** @type {any} */ (window);
  w.Capacitor = w.Capacitor ?? {};
  w.Capacitor.Plugins = w.Capacitor.Plugins ?? {};
  w.Capacitor.Plugins.MalletRoomScan = {
    available: async () => ({ available: true }),
    captureRoom: async () => ({ status: "cancelled" }),
  };
};

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: VIEWPORT,
  deviceScaleFactor: SCALE,
  isMobile: true,
  hasTouch: true,
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
});
await context.addInitScript(NATIVE_STUB);
const page = await context.newPage();

/** Wait for a piece of the screen's own content, then fire. */
async function shot(name, settleText) {
  if (settleText) {
    await page.getByText(settleText, { exact: false }).first().waitFor({ state: "visible", timeout: 45_000 });
  }
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`  ${name}.png`);
}

try {
  console.log(`\n  base  ${BASE}\n  out   ${OUT}\n  size  ${VIEWPORT.width}x${VIEWPORT.height} @${SCALE}x = ${VIEWPORT.width * SCALE}x${VIEWPORT.height * SCALE}\n`);

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email").fill(OWNER_EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/dashboard", { timeout: 60_000 });
  await page.waitForTimeout(4000);

  // 01 — the day
  await page.goto(`${BASE}/my-day`, { waitUntil: "domcontentloaded" });
  await shot("01-my-day", "Estimate — whole-house repipe");

  // 02 — the job in hand (tech job sheet)
  await page.getByText("Estimate — whole-house repipe").first().click();
  await shot("02-job", "1544 NW Fort Clatsop St");

  // 04 — measure on site (the native LiDAR entry point). Shot out of numeric order
  // because it is one tap on from 02 and reloading the job costs 20 seconds.
  await page.getByText("Quote", { exact: true }).first().click();
  await shot("04-measure", "Scan a room");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(1200);

  // 03 — the quote that went out
  await page.goto(`${BASE}/customers`, { waitUntil: "domcontentloaded" });
  await page.getByText("Alicia Brennan").first().waitFor({ state: "visible", timeout: 45_000 });
  await page.waitForTimeout(2500);
  await page.getByText("Alicia Brennan").first().click();
  await page.getByText("Whole-house repipe — copper to PEX").first().click();
  await shot("03-quote", "$10,954");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(1200);

  // 05 — getting paid
  await page.goto(`${BASE}/money`, { waitUntil: "domcontentloaded" });
  await shot("05-money", "READY TO BILL");

  // 06 — the board
  await page.goto(`${BASE}/jobs?tab=schedule`, { waitUntil: "domcontentloaded" });
  await shot("06-schedule", "To schedule");

  console.log(`\n  done — verify dimensions with:  sips -g pixelWidth -g pixelHeight ${OUT}/*.png\n`);
} finally {
  await browser.close();
}
