/**
 * scripts/verify-app-review-path.mjs
 *
 * Walks the exact path docs/app-review-notes.md tells Apple's reviewer to walk, at 390x844,
 * and screenshots every step. Run it before EVERY submission and resubmission: the demo shop
 * is data in a shared database, and a path that worked last week can be broken by a seed
 * that never ran, a toggle that got flipped, or a job whose visit aged out of "today".
 *
 *   node scripts/verify-app-review-path.mjs                        # deployed app
 *   node scripts/verify-app-review-path.mjs http://localhost:3411  # a local prod build
 *   node scripts/verify-app-review-path.mjs <base> <outDir>
 *
 * WHY IT STUBS THE NATIVE PLUGIN. The scan affordances are gated on `useRoomScanAvailable()`,
 * which asks the `MalletRoomScan` Capacitor plugin whether the device has LiDAR. In any browser
 * that plugin is absent, so the scan rows are CORRECTLY invisible and there is nothing to
 * verify. The stub installs the same `window.Capacitor.Plugins.MalletRoomScan` shape the iOS
 * shell injects via WKUserScript, which is what lets a desktop browser prove the render path.
 * The stub does NOT fake the scanner — `captureRoom` resolves "cancelled"; everything up to the
 * native handoff is the real product.
 *
 * Pass --no-stub to confirm the opposite: that the rows are absent without a native bridge.
 * That is the expected browser behaviour, not a bug — see docs/app-review-notes.md.
 *
 * THE COLD-LOAD CASE IS THE ONE THAT REGRESSES. `store.toggles.measurementEstimating` is
 * written ONLY by SettingsHydrator, and the store has no persist middleware, so any route whose
 * layout does not mount that hydrator shows no scan row on a hard load — while still working
 * if you soft-navigate in from a route that does. Check 4 loads /my-day cold, in a fresh
 * context, specifically to catch that.
 */

import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { ORG_NAME, OWNER_EMAIL } from "./app-review/shop-data.mjs";

const BASE = process.argv[2]?.startsWith("http") ? process.argv[2] : "https://app.trymallet.com";
const OUT = process.argv.find((a, i) => i > 2 && !a.startsWith("--")) ?? "/tmp/app-review-path";
const STUB_NATIVE = !process.argv.includes("--no-stub");
const PASSWORD = process.env.APP_REVIEW_PASSWORD ?? "Ridgeline-Review-7Q4t!2846";

/** The reviewer's job — must match JOBS[0] in app-review/shop-data.mjs. */
const REVIEW_JOB_TITLE = "Estimate — whole-house repipe";
const REVIEW_CUSTOMER = "Alicia Brennan";

mkdirSync(OUT, { recursive: true });

const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok, detail });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  return ok;
};

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

async function newContext() {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
  });
  if (STUB_NATIVE) await context.addInitScript(NATIVE_STUB);
  return context;
}

/** Sign in and settle on the landing route. Returns the page. */
async function signIn(context) {
  const page = await context.newPage();
  const failures = [];
  page.on("response", (r) => {
    if (r.url().includes("/api/trpc") && r.status() >= 500) failures.push(r.url().split("?")[0]);
  });
  page.serverFailures = failures;
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email").fill(OWNER_EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/dashboard", { timeout: 45_000 });
  await page.waitForTimeout(3500);
  return page;
}

const shot = async (page, n, name) => {
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${OUT}/${String(n).padStart(2, "0")}-${name}.png` });
};

const seen = async (locator) => locator.first().isVisible().catch(() => false);

try {
  console.log(`\n  base       ${BASE}`);
  console.log(`  native     ${STUB_NATIVE ? "STUBBED (simulating the iOS shell)" : "absent (browser behaviour)"}`);
  console.log(`  login      ${OWNER_EMAIL}\n`);

  // -- 1. Sign in, land populated ------------------------------------------
  const context = await newContext();
  const page = await signIn(context);
  check("1. sign in reaches the app with no email step", page.url().includes("/dashboard"), page.url());
  await shot(page, 1, "dashboard");
  check("1b. landing screen names the demo shop", (await page.content()).includes(ORG_NAME));
  check(
    "1c. landing screen is populated (money tiles carry real figures)",
    await seen(page.getByText(/OUT TODAY/i)),
  );

  // -- 2. The shop has customers -------------------------------------------
  await page.getByRole("link", { name: /Customers/ }).first().click();
  await page.waitForURL("**/customers", { timeout: 30_000 });
  await page.waitForTimeout(2500);
  await shot(page, 2, "customers");
  check("2. customer list is populated", await seen(page.getByText(REVIEW_CUSTOMER)));

  // -- 3. PRIMARY scan path: the composer's Measure card -------------------
  // The Measure card returns null unless toggles.measurementEstimating is true, so its mere
  // presence proves the org toggle reached the client.
  await page.goto(`${BASE}/composer`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
  check(
    "3. composer renders the Measure card (proves measurementEstimating reached the client)",
    await seen(page.getByRole("heading", { name: "Measure" })),
  );
  const custInput = page.getByPlaceholder(/customer/i).first();
  if (await seen(custInput)) {
    await custInput.fill(REVIEW_CUSTOMER.split(" ")[0]);
    await page.waitForTimeout(2500);
    const match = page.getByText(REVIEW_CUSTOMER).first();
    if (await seen(match)) await match.click();
    await page.waitForTimeout(2500);
  }
  await shot(page, 3, "composer-measure");
  check("3b. composer offers '+ Add a room'", await seen(page.getByRole("button", { name: /Add a room/i })));
  const composerScan = await seen(page.getByRole("button", { name: /^Scan room$/i }));
  check(
    `3c. composer 'Scan room' ${STUB_NATIVE ? "visible with a native bridge" : "absent without one"}`,
    STUB_NATIVE ? composerScan : !composerScan,
  );

  // -- 4. COLD LOAD of /my-day — the regression this guards ----------------
  // A brand-new context so nothing from the office routes is in the store. If the field
  // layout stops hydrating settings, this is the check that fails.
  const coldContext = await newContext();
  const cold = await signIn(coldContext);
  await cold.goto(`${BASE}/my-day`, { waitUntil: "domcontentloaded" });
  await cold.waitForTimeout(5000);
  await shot(cold, 4, "my-day-cold");
  const coldJob = cold.getByText(REVIEW_JOB_TITLE).first();
  check("4. cold load of /my-day shows today's assigned job", await seen(coldJob), REVIEW_JOB_TITLE);
  if (await seen(coldJob)) {
    await coldJob.click();
    await cold.waitForTimeout(2500);
    const quoteTab = cold.getByRole("tab", { name: "Quote" }).first();
    if (check("4b. job sheet has a Quote tab", await seen(quoteTab))) {
      await quoteTab.click();
      await cold.waitForTimeout(2500);
      await shot(cold, 5, "quote-tab-cold");
      check("4c. Quote tab shows the Scope section", await seen(cold.getByText("Scope", { exact: true })));
      const coldScan = await seen(cold.getByRole("button", { name: /Scan a room/i }));
      check(
        `4d. COLD 'Scan a room' ${STUB_NATIVE ? "visible — the field layout hydrates settings" : "absent without a native bridge"}`,
        STUB_NATIVE ? coldScan : !coldScan,
      );
      if (coldScan) {
        await cold.getByRole("button", { name: /Scan a room/i }).first().click();
        await cold.waitForTimeout(2000);
        await shot(cold, 6, "scan-room-sheet");
        check(
          "4e. room sheet hands off to the native scanner ('Start scanning')",
          await seen(cold.getByRole("button", { name: /Start scanning/i })),
        );
      }
    }
  }

  const serverErrors = [...page.serverFailures, ...cold.serverFailures];
  check("5. no 5xx from any tRPC call on the reviewer's path", serverErrors.length === 0, serverErrors.join(", "));
} catch (err) {
  check("walkthrough threw", false, err.message);
} finally {
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n  ${checks.length - failed.length}/${checks.length} checks passed`);
  console.log(`  screenshots: ${OUT}\n`);
  if (failed.length > 0) process.exitCode = 1;
  await browser.close();
}
