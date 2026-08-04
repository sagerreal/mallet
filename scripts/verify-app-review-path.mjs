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
 * THE THREE DEVICE MODES ARE THREE STATES, AND ALL THREE MUST SHOW THE ROW. The scan control is
 * the app's answer to guideline 4.2, so it renders on every device and states the reason it
 * cannot run rather than disappearing:
 *
 *   default      plugin present, available() true   → row LIVE
 *   --no-lidar   plugin present, available() false  → row DISABLED, "…reports no LiDAR sensor…"
 *   --no-stub    no plugin at all (a browser)       → row DISABLED, "open the Mallet iPhone app…"
 *
 * --no-lidar is the mode that matters most for submission: it is what a reviewer holding a base
 * iPhone sees, and you cannot choose the device Apple reviews on. --no-stub doubles as the check
 * that testing at app.trymallet.com in a browser now shows the scanner and explains itself,
 * instead of showing nothing and reading as broken.
 *
 * THE DEVICE IS NOT THE ONLY AXIS, AND IT WAS THE ONLY ONE THIS SCRIPT USED TO VARY. An
 * adversarial pass found four more configurations that made the affordance VANISH, each of them
 * reachable by a reviewer, and none of them visible to a run that only changes the plugin stub.
 * Every one is now a check in EVERY mode:
 *
 *   4  a technician's own /my-day       — v1.settings.get is ownerOrOffice and the field layout
 *      (check 6)                          gated its hydrator behind !isTech, so store.toggles was
 *                                         never written for the role the field scanner is FOR.
 *   5  a CLOSED job's sheet             — the row was also gated on !readOnly. Reachable in the
 *      (check 5)                          field: tap Done, then tap the card again to review it.
 *                                         (NOT via the office /jobs list — that opens MODAL.JOB,
 *                                         a different sheet with no scan row by design.)
 *   6  /composer before a customer      — the whole control lived behind `leadId !== null`, so
 *      (check 3a)                         the native affordance did not exist until step 4.
 *   7  SETTINGS UNAVAILABLE             — the gate was a boolean whose placeholder was `false` and
 *      (check 7)                          SettingsHydrator its only writer, so one 500 from
 *                                         v1.settings.get removed the Measure CARD and every scan
 *                                         control in the app, unexplained. This happened for real.
 *
 * THE COLD-LOAD CASE IS THE ONE THAT REGRESSES. `store.toggles.measurementEstimating` is written
 * only by a settings hydrator, and the store has no persist middleware, so any route whose layout
 * does not mount one shows no scan row on a hard load — while still working if you soft-navigate
 * in from a route that does. Checks 4 and 6 load /my-day cold, in fresh contexts, for that.
 */

import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { ORG_NAME, OWNER_EMAIL, CREW, JOBS } from "./app-review/shop-data.mjs";

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
  "no-lidar": "This device reports no LiDAR sensor — room scanning needs an iPhone Pro or iPad Pro.",
  "no-native-app": "Open the Mallet iPhone app to scan — a browser cannot reach the LiDAR sensor.",
  "job-closed": "This job is closed — reopen it to scan a room.",
  "no-customer": "Pick a customer first — a room scan attaches to one of their jobs.",
};

/**
 * What a surface should say, given this run's device state and the surface's OWN blocker.
 *
 * The device answer wins when there is one: on a base iPhone "reports no LiDAR" is true whether or
 * not a customer is picked, and it is the more fundamental fact — which is also the precedence the
 * app implements. `null` means "expect a LIVE control".
 */
const expected = (surfaceBlocker = null) =>
  SCAN_STATE === "ready" ? (surfaceBlocker ? SCAN_REASON[surfaceBlocker] : null) : SCAN_REASON[SCAN_STATE];

/** The reviewer's job — must match JOBS[0] in app-review/shop-data.mjs. */
const REVIEW_JOB_TITLE = "Estimate — whole-house repipe";
const REVIEW_CUSTOMER = "Alicia Brennan";

/** A TECH login and the job on their own agenda today — the field surface's own configuration. */
const TECH = CREW.find((c) => c.role === "tech");
const TECH_JOB_TITLE = JOBS.find(
  (j) => j.assignee === TECH?.slug && j.status === "scheduled" && j.dayOffset === 0,
)?.title;


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

async function newContext(storageState = undefined) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
    ...(storageState ? { storageState } : {}),
  });
  if (STUB_NATIVE) await context.addInitScript(NATIVE_STUB, STUB_LIDAR);
  return context;
}

/** A page with the 5xx listener attached. Every check's page goes through here. */
function watch(page) {
  const failures = [];
  page.on("response", (r) => {
    if (r.url().includes("/api/trpc") && r.status() >= 500) failures.push(r.url().split("?")[0]);
  });
  page.serverFailures = failures;
  return page;
}

/**
 * A context already holding a role's session, WITHOUT logging in again.
 *
 * Each role signs in for real exactly once per run; the later contexts restore that session
 * cookie. Six live logins per run was tripping Supabase's auth rate limit and turning the tool
 * into a coin flip — a pre-submission gate that fails at random is worse than no gate.
 *
 * This does NOT weaken the cold-load checks. What they exercise is an empty Zustand STORE on a
 * hard load, and the store has no persist middleware — a restored auth cookie puts nothing in it.
 * A fresh context with a restored session is exactly as cold as one that just logged in.
 */
async function contextFor(state) {
  const context = await newContext(state);
  return context;
}

/**
 * Assert one scan affordance is in the state this run expects: LIVE and enabled, or PRESENT,
 * disabled and carrying its reason. "Absent" is never a pass — a scanner that vanishes is the
 * bug this checks for.
 */
async function checkScanControl(page, id, name, locator, surfaceBlocker = null) {
  const button = locator.first();
  if (!(await waitSeen(button))) return check(`${id}. '${name}' is on the page`, false, "NOT RENDERED AT ALL");

  const disabled = await button.isDisabled();
  const reason = expected(surfaceBlocker);
  if (reason === null) {
    return check(`${id}. '${name}' is live (native bridge reports LiDAR)`, !disabled, disabled ? "disabled" : "");
  }

  const reasonShown = await seen(page.getByText(reason, { exact: true }));
  // The reason must be attached to the control, not just floating on the page — a dimmed
  // button whose explanation is not announced with it is still a mystery to a screen reader.
  const describedBy = await button.getAttribute("aria-describedby");
  // An attribute selector, not `#id`: React's useId emits ids containing characters (« » :)
  // that are not valid in a bare CSS id selector, and CSS.escape does not exist in Node.
  const describedText = describedBy
    ? await page.locator(`[id="${describedBy}"]`).first().textContent().catch(() => null)
    : null;

  // Name the blocker the run is ACTUALLY asserting, not the one the surface asked for: on a
  // non-ready device the device answer wins, and a label saying "no-customer" beside the LiDAR
  // sentence would misreport what was checked.
  const effective = SCAN_STATE === "ready" ? surfaceBlocker : SCAN_STATE;
  return check(
    `${id}. '${name}' is present, disabled and says why (${effective})`,
    disabled && reasonShown && describedText?.trim() === reason,
    `disabled=${disabled} reasonShown=${reasonShown} describedBy=${describedBy ?? "none"}`,
  );
}


/**
 * Sign in and settle on the landing route. Returns the page.
 *
 * `landing` differs by role: owner/office land on /dashboard, a TECH is bounced there and lands on
 * the field surface instead (the office guard admits only owner/office). Every crew member the
 * seeder creates shares one password — see ensureAuthUser in scripts/seed-app-review-org.mjs.
 */
async function signIn(context, email = OWNER_EMAIL, landing = "**/dashboard") {
  const page = watch(await context.newPage());
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(landing, { timeout: 45_000 });
  await page.waitForTimeout(3500);
  return page;
}

const shot = async (page, n, name) => {
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${OUT}/${String(n).padStart(2, "0")}-${name}.png` });
};

const seen = async (locator) => locator.first().isVisible().catch(() => false);

/**
 * Wait for something to appear, then report whether it did — instead of sleeping a fixed number of
 * milliseconds and hoping. The fixed sleeps made this script a coin flip: the very same check
 * passed in one mode and failed in the next run, purely on how loaded the machine was. A
 * pre-submission gate that fails at random gets ignored, which is worse than not having one.
 */
const waitSeen = async (locator, timeout = 30_000) => {
  await locator.first().waitFor({ state: "visible", timeout }).catch(() => {});
  return seen(locator);
};

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
  // The one real owner login of the run; every later owner context restores this session.
  const ownerState = await context.storageState();
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
  check("2. customer list is populated", await waitSeen(page.getByText(REVIEW_CUSTOMER)));

  // -- 3. PRIMARY scan path: the composer's Measure card -------------------
  // The Measure card returns null unless toggles.measurementEstimating is true, so its mere
  // presence proves the org toggle reached the client.
  await page.goto(`${BASE}/composer`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
  check(
    "3. composer renders the Measure card (proves measurementEstimating reached the client)",
    await waitSeen(page.getByRole("heading", { name: "Measure" })),
  );
  // BEFORE a customer is picked. The scan control used to live behind `leadId !== null`, so a
  // reviewer landing here saw a Measure card with no native affordance in it at all — the app's
  // whole answer to 4.2 did not appear until step 4 of the notes.
  await shot(page, 3, "composer-no-customer");
  await checkScanControl(
    page,
    "3a",
    "Scan room",
    page.getByRole("button", { name: /^Scan room$/i }),
    "no-customer",
  );
  const custInput = page.getByPlaceholder(/customer/i).first();
  if (await seen(custInput)) {
    await custInput.fill(REVIEW_CUSTOMER.split(" ")[0]);
    await page.waitForTimeout(2500);
    const match = page.getByText(REVIEW_CUSTOMER).first();
    if (await seen(match)) await match.click();
    await page.waitForTimeout(2500);
  }
  await shot(page, 4, "composer-measure");
  check("3b. composer offers '+ Add a room'", await seen(page.getByRole("button", { name: /Add a room/i })));
  await checkScanControl(page, "3c", "Scan room", page.getByRole("button", { name: /^Scan room$/i }));

  // -- 4. COLD LOAD of /my-day — the regression this guards ----------------
  // A brand-new context so nothing from the office routes is in the store. If the field
  // layout stops hydrating settings, this is the check that fails.
  const coldContext = await contextFor(ownerState);
  const cold = watch(await coldContext.newPage());
  await cold.goto(`${BASE}/my-day`, { waitUntil: "domcontentloaded" });
  await cold.waitForTimeout(5000);
  await shot(cold, 5, "my-day-cold");
  const coldJob = cold.getByText(REVIEW_JOB_TITLE).first();
  check("4. cold load of /my-day shows today's assigned job", await waitSeen(coldJob), REVIEW_JOB_TITLE);
  if (await seen(coldJob)) {
    await coldJob.click();
    await cold.waitForTimeout(2500);
    const quoteTab = cold.getByRole("tab", { name: "Quote" }).first();
    if (check("4b. job sheet has a Quote tab", await waitSeen(quoteTab))) {
      await quoteTab.click();
      await cold.waitForTimeout(2500);
      await shot(cold, 6, "quote-tab-cold");
      check("4c. Quote tab shows the Scope section", await seen(cold.getByText("Scope", { exact: true })));
      // The row must be here in EVERY mode — its presence on a cold load still proves the field
      // layout hydrates settings, because measurementEstimating gates the row itself.
      await checkScanControl(cold, "4d", "Scan a room", cold.getByRole("button", { name: /Scan a room/i }));
      if (SCAN_STATE === "ready") {
        await cold.getByRole("button", { name: /Scan a room/i }).first().click();
        await cold.waitForTimeout(2000);
        await shot(cold, 7, "scan-room-sheet");
        check(
          "4e. room sheet hands off to the native scanner ('Start scanning')",
          await seen(cold.getByRole("button", { name: /Start scanning/i })),
        );
      } else {
        // A disabled control must not open the sheet — that would be the dead button we avoided.
        await cold.getByRole("button", { name: /Scan a room/i }).first().click({ force: true });
        await cold.waitForTimeout(1500);
        await shot(cold, 7, "scan-row-disabled");
        check(
          "4e. the disabled scan row does not open the scan sheet",
          !(await seen(cold.getByRole("button", { name: /Start scanning/i }))),
        );
      }
    }
  }

  // -- 5. A CLOSED JOB -----------------------------------------------------
  // The row was gated on `!readOnly` too, so the scanner vanished the moment a job closed. The
  // reachable route is the field one: tap Done on today's job and then tap the card again to
  // review it — the card is still on screen (optimistic status) and the sheet is now read-only.
  //
  // The check does NOT complete a real job. The demo shop is data in a shared database and a
  // stray "complete" would take the reviewer's job off today's agenda for good. Instead the myDay
  // RESPONSE is rewritten in flight — same technique as the native stub above and the settings 500
  // below: the server is untouched, and the real client code walks its real read-only branch.
  //
  // Signed in as the TECHNICIAN, not the owner: on the field surface an owner also mounts the
  // office JobsHydrator (v1.jobs.list), which re-hydrates store.jobs with the job's REAL status
  // and undoes the rewrite. A tech's store is fed by field.myDay alone — which is also whose
  // action this is.
  let rewrites = 0;
  const closedContext = await newContext();
  await closedContext.route(/\/api\/trpc\/.*field\.myDay/, async (route) => {
    const response = await route.fetch();
    const original = await response.text();
    // BOTH the job's status AND its visits'. The store does not take a job's status from the DTO
    // when the job has visits — dtoJobToStoreJob RECALCULATES it from their placement state
    // (recalcJobStatus), so a job is "done" exactly when every placed visit is. Rewriting only the
    // job's own status is inert. "scheduled" is a job status and "pending" a visit one; the DTO's
    // "complete" maps to the store's "done" on both, which is what readOnly reads.
    const body = original
      .replaceAll('"status":"scheduled"', '"status":"complete"')
      .replaceAll('"status":"pending"', '"status":"complete"');
    if (body !== original) rewrites += 1;
    await route.fulfill({ response, body });
  });
  const closed = await signIn(closedContext, TECH.email, "**/my-day");
  // The one real TECH login of the run; check 6 restores this session.
  const techState = await closedContext.storageState();
  await closed.goto(`${BASE}/my-day`, { waitUntil: "domcontentloaded" });
  await closed.waitForTimeout(5000);
  // Without this the check could "pass" against a job that was never closed at all.
  check("5. the myDay response was rewritten to a CLOSED job", rewrites > 0, `${rewrites} rewrites`);
  const closedJob = closed.getByText(TECH_JOB_TITLE).first();
  if (check("5a. the closed job's sheet still opens", await waitSeen(closedJob), TECH_JOB_TITLE)) {
    await closedJob.click();
    await closed.waitForTimeout(2500);
    const closedTab = closed.getByRole("tab", { name: "Quote" }).first();
    if (check("5b. the closed job's sheet has a Quote tab", await waitSeen(closedTab))) {
      await closedTab.click();
      await closed.waitForTimeout(2500);
      await shot(closed, 12, "quote-tab-closed-job");
      await checkScanControl(
        closed,
        "5c",
        "Scan a room",
        closed.getByRole("button", { name: /Scan a room/i }),
        "job-closed",
      );
    }
  }

  // -- 6. THE TECHNICIAN'S OWN /my-day ------------------------------------
  // v1.settings.get is ownerOrOffice and the field layout gated its hydrator behind !isTech, and
  // that hydrator was the only writer of store.toggles — so for the role the field scanner exists
  // for, the row could never render at all, on any device. A tech also cannot soft-navigate into
  // an office route to fix it: the office guard bounces them straight back.
  const techContext = await contextFor(techState);
  const tech = watch(await techContext.newPage());
  await tech.goto(`${BASE}/my-day`, { waitUntil: "domcontentloaded" });
  await tech.waitForTimeout(5000);
  await shot(tech, 8, "my-day-tech-cold");
  const techJob = tech.getByText(TECH_JOB_TITLE).first();
  if (check(`6. a TECH's cold /my-day shows their own job`, await waitSeen(techJob), TECH_JOB_TITLE)) {
    await techJob.click();
    await tech.waitForTimeout(2500);
    const techQuoteTab = tech.getByRole("tab", { name: "Quote" }).first();
    if (check("6b. the tech job sheet has a Quote tab", await waitSeen(techQuoteTab))) {
      await techQuoteTab.click();
      await tech.waitForTimeout(2500);
      await shot(tech, 9, "quote-tab-tech");
      await checkScanControl(tech, "6c", "Scan a room", tech.getByRole("button", { name: /Scan a room/i }));
    }
  }

  // -- 7. SETTINGS UNAVAILABLE -------------------------------------------
  // The one that already happened, on a malformed settings blob. The gate was a boolean whose
  // pre-hydration placeholder was `false` and a settings hydrator its only writer, so a failed
  // read was indistinguishable from "this shop does not measure" — and took the Measure CARD with
  // it, not just a button. Both settings reads are forced to 500 here; the affordance must survive.
  const brokenContext = await contextFor(ownerState);
  await brokenContext.route(/\/api\/trpc\/.*settings\.(get|fieldToggles)/, (route) =>
    route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"forced by the verifier"}' }),
  );
  const broken = watch(await brokenContext.newPage());
  await broken.goto(`${BASE}/composer`, { waitUntil: "domcontentloaded" });
  await broken.waitForTimeout(4000);
  await shot(broken, 10, "composer-settings-down");
  check(
    "7. the Measure card SURVIVES a 500 from v1.settings.get",
    await waitSeen(broken.getByRole("heading", { name: "Measure" })),
  );
  await checkScanControl(
    broken,
    "7b",
    "Scan room",
    broken.getByRole("button", { name: /^Scan room$/i }),
    "no-customer",
  );
  await broken.goto(`${BASE}/my-day`, { waitUntil: "domcontentloaded" });
  await broken.waitForTimeout(5000);
  const brokenJob = broken.getByText(REVIEW_JOB_TITLE).first();
  if (check("7c. /my-day still lists work with settings down", await waitSeen(brokenJob))) {
    await brokenJob.click();
    await broken.waitForTimeout(2500);
    const brokenTab = broken.getByRole("tab", { name: "Quote" }).first();
    if (check("7d. that sheet still has a Quote tab", await waitSeen(brokenTab))) {
      await brokenTab.click();
      await broken.waitForTimeout(2500);
      await shot(broken, 11, "quote-tab-settings-down");
      await checkScanControl(
        broken,
        "7e",
        "Scan a room",
        broken.getByRole("button", { name: /Scan a room/i }),
      );
    }
  }

  // The broken context's 5xx are DELIBERATE — it is excluded from this check by construction.
  const serverErrors = [
    ...page.serverFailures,
    ...cold.serverFailures,
    ...closed.serverFailures,
    ...tech.serverFailures,
  ];
  check("8. no 5xx from any tRPC call on the reviewer's path", serverErrors.length === 0, serverErrors.join(", "));
} catch (err) {
  check("walkthrough threw", false, err.message);
} finally {
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n  ${checks.length - failed.length}/${checks.length} checks passed`);
  console.log(`  screenshots: ${OUT}\n`);
  if (failed.length > 0) process.exitCode = 1;
  await browser.close();
}
