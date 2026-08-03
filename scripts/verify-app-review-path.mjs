/**
 * scripts/verify-app-review-path.mjs
 *
 * Walks the exact path docs/app-review-notes.md tells Apple's reviewer to walk, at 390x844,
 * and screenshots every step. Run it before EVERY submission and resubmission: the demo shop
 * is data in a shared database, and a path that worked last week can be broken by a seed
 * that never ran, a toggle that got flipped, or a job whose visit aged out of "today".
 *
 *   node scripts/verify-app-review-path.mjs                        # deployed app, scanner READY
 *   node scripts/verify-app-review-path.mjs --no-lidar            # a base (non-Pro) iPhone
 *   node scripts/verify-app-review-path.mjs --no-stub             # a plain browser, no app
 *   node scripts/verify-app-review-path.mjs http://localhost:3411 # a local prod build
 *   node scripts/verify-app-review-path.mjs <base> <outDir>
 *
 * WHY IT STUBS THE NATIVE PLUGIN. The scan affordances ask the `MalletRoomScan` Capacitor
 * plugin whether this device can scan. In any browser that plugin is absent, so the default run
 * installs the same `window.Capacitor.Plugins.MalletRoomScan` shape the iOS shell injects via
 * WKUserScript — that is what lets a desktop browser prove the LIVE render path. The stub does
 * NOT fake the scanner: `captureRoom` resolves "cancelled"; everything up to the native handoff
 * is the real product.
 *
 * THE THREE MODES ARE THE THREE STATES, AND ALL THREE MUST SHOW THE ROW. The scan control is
 * the app's answer to guideline 4.2, so it renders on every device and states the reason it
 * cannot run rather than disappearing:
 *
 *   default      plugin present, available() true   → row LIVE
 *   --no-lidar   plugin present, available() false  → row DISABLED, "needs an iPhone Pro…"
 *   --no-stub    no plugin at all (a browser)       → row DISABLED, "open the Mallet iPhone app…"
 *
 * --no-lidar is the mode that matters most for submission: it is what a reviewer holding a base
 * iPhone sees, and you cannot choose the device Apple reviews on. --no-stub doubles as the check
 * that testing at app.trymallet.com in a browser now shows the scanner and explains itself,
 * instead of showing nothing and reading as broken.
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
const STUB_NATIVE = !process.argv.includes("--no-stub");
/** --no-lidar keeps the bridge but makes the plugin report an unsupported device. */
const STUB_LIDAR = !process.argv.includes("--no-lidar");
const PASSWORD = process.env.APP_REVIEW_PASSWORD ?? "Ridgeline-Review-7Q4t!2846";

/** Which of the three scan states this run is exercising. */
const SCAN_STATE = !STUB_NATIVE ? "no-native-app" : !STUB_LIDAR ? "no-lidar" : "ready";
// Per-state output dir by default, so running all three modes does not clobber one set of shots.
const OUT = process.argv.find((a, i) => i > 2 && !a.startsWith("--")) ?? `/tmp/app-review-path-${SCAN_STATE}`;

/**
 * The exact sentences components/shared/scan-unavailable.tsx renders. Copied deliberately:
 * this script runs against a DEPLOYED bundle, so asserting the literal string is what proves
 * the shipped app says it. If you change the copy there, change it here and the run will tell
 * you whether the deploy carrying it is live yet.
 */
const SCAN_REASON = {
  "no-lidar": "Needs an iPhone Pro or iPad Pro — room scanning uses the LiDAR sensor.",
  "no-native-app": "Open the Mallet iPhone app to scan — a browser cannot reach the LiDAR sensor.",
};

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

/**
 * The plugin shape Capacitor injects into the shell's webview. `lidar` false is a base iPhone:
 * the bridge and the plugin are both there, the DEVICE just cannot run RoomPlan — which is
 * exactly what `RoomCaptureSession.isSupported` reports on a non-Pro model.
 */
const NATIVE_STUB = (lidar) => {
  const w = /** @type {any} */ (window);
  w.Capacitor = w.Capacitor ?? {};
  w.Capacitor.Plugins = w.Capacitor.Plugins ?? {};
  w.Capacitor.Plugins.MalletRoomScan = {
    available: async () => (lidar ? { available: true } : { available: false, reason: "device_unsupported" }),
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
  if (STUB_NATIVE) await context.addInitScript(NATIVE_STUB, STUB_LIDAR);
  return context;
}

/**
 * Assert one scan affordance is in the state this run expects: LIVE and enabled, or PRESENT,
 * disabled and carrying its reason. "Absent" is never a pass — a scanner that vanishes is the
 * bug this checks for.
 */
async function checkScanControl(page, id, name, locator) {
  const button = locator.first();
  if (!(await seen(button))) return check(`${id}. '${name}' is on the page`, false, "not rendered at all");

  const disabled = await button.isDisabled();
  if (SCAN_STATE === "ready") {
    return check(`${id}. '${name}' is live (native bridge reports LiDAR)`, !disabled, disabled ? "disabled" : "");
  }

  const reason = SCAN_REASON[SCAN_STATE];
  const reasonShown = await seen(page.getByText(reason, { exact: true }));
  // The reason must be attached to the control, not just floating on the page — a dimmed
  // button whose explanation is not announced with it is still a mystery to a screen reader.
  const describedBy = await button.getAttribute("aria-describedby");
  // An attribute selector, not `#id`: React's useId emits ids containing characters (« » :)
  // that are not valid in a bare CSS id selector, and CSS.escape does not exist in Node.
  const describedText = describedBy
    ? await page.locator(`[id="${describedBy}"]`).first().textContent().catch(() => null)
    : null;

  return check(
    `${id}. '${name}' is present, disabled and says why (${SCAN_STATE})`,
    disabled && reasonShown && describedText?.trim() === reason,
    `disabled=${disabled} reasonShown=${reasonShown} describedBy=${describedBy ?? "none"}`,
  );
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
  console.log(
    `  native     ${
      SCAN_STATE === "ready"
        ? "STUBBED, LiDAR present (simulating an iPhone Pro in the shell)"
        : SCAN_STATE === "no-lidar"
          ? "STUBBED, no LiDAR (simulating a base iPhone in the shell)"
          : "absent (plain browser — no Capacitor bridge)"
    }`,
  );
  console.log(`  scan row   expected ${SCAN_STATE === "ready" ? "LIVE" : `DISABLED — "${SCAN_REASON[SCAN_STATE]}"`}`);
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
  await checkScanControl(page, "3c", "Scan room", page.getByRole("button", { name: /^Scan room$/i }));

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
      // The row must be here in EVERY mode — its presence on a cold load still proves the field
      // layout hydrates settings, because measurementEstimating gates the row itself.
      await checkScanControl(cold, "4d", "Scan a room", cold.getByRole("button", { name: /Scan a room/i }));
      if (SCAN_STATE === "ready") {
        await cold.getByRole("button", { name: /Scan a room/i }).first().click();
        await cold.waitForTimeout(2000);
        await shot(cold, 6, "scan-room-sheet");
        check(
          "4e. room sheet hands off to the native scanner ('Start scanning')",
          await seen(cold.getByRole("button", { name: /Start scanning/i })),
        );
      } else {
        // A disabled control must not open the sheet — that would be the dead button we avoided.
        await cold.getByRole("button", { name: /Scan a room/i }).first().click({ force: true });
        await cold.waitForTimeout(1500);
        await shot(cold, 6, "scan-row-disabled");
        check(
          "4e. the disabled scan row does not open the scan sheet",
          !(await seen(cold.getByRole("button", { name: /Start scanning/i }))),
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
