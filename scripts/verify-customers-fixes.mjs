import { chromium } from "@playwright/test";
const base = "http://localhost:3000";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1512, height: 950 } });
const log = (s) => console.log("STEP:", s);

await p.goto(base + "/login", { waitUntil: "networkidle" });
await p.getByLabel("Email").fill("owner@e2e.mallet.test");
await p.getByLabel("Password").fill("e2e-password-1");
await p.getByRole("button", { name: "Sign in" }).click();
await p.waitForURL("**/dashboard", { timeout: 30000 });
await p.goto(base + "/customers", { waitUntil: "networkidle" });
await p.waitForTimeout(1000);

// ---- BUG 1: list-header "Clean up" opens the Sweep modal ----
try {
  await p.getByRole("button", { name: /Clean up/ }).click();
  await p.waitForTimeout(500);
  const title = await p.getByText("Clean up leads").first().isVisible().catch(() => false);
  const boxes = await p.locator(".overlay.open .sweeprow input[type=checkbox]").count();
  const actions = await p.locator(".overlay.open").getByRole("button", { name: /Delete checked|Archive checked|Mark checked Lost/ }).count();
  await p.screenshot({ path: "/tmp/fix-1-sweep.png" });
  log(`BUG1 sweep: title='Clean up leads' visible=${title}, checkboxes=${boxes}, actionBtns=${actions}`);
  // arm-delete two-tap check: check one box, tap delete once, expect "Really delete"
  if (boxes > 0) {
    await p.locator(".overlay.open .sweeprow input[type=checkbox]").first().check();
    await p.getByRole("button", { name: /Delete checked/ }).click();
    await p.waitForTimeout(200);
    const armed = await p.getByText(/Really delete/).isVisible().catch(() => false);
    log(`BUG1 delete-arm: shows 'Really delete' on first tap=${armed}`);
    await p.screenshot({ path: "/tmp/fix-1b-sweep-armed.png" });
  }
  await p.keyboard.press("Escape");
  await p.waitForTimeout(300);
} catch (e) { log("BUG1 FAIL " + e.message.split("\n")[0]); }

// ---- BUG 2: New customer modal opens with 'Full name' placeholder, no glitch ----
try {
  await p.getByRole("button", { name: /New customer/ }).click();
  await p.waitForTimeout(500);
  const nameInput = p.locator(".overlay.open input").first();
  const ph = await nameInput.getAttribute("placeholder");
  await p.screenshot({ path: "/tmp/fix-2-newcustomer.png" });
  log(`BUG2 new-customer: name placeholder='${ph}' (expect 'Full name'), prefilled value='${await nameInput.inputValue()}'`);
} catch (e) { log("BUG2 FAIL " + e.message.split("\n")[0]); }

// ---- BUG 3: Add a custom field actually adds a persisting row ----
try {
  // expand More details
  await p.getByText("More details").first().click();
  await p.waitForTimeout(300);
  await p.getByRole("button", { name: /Add a custom field/ }).click();
  await p.waitForTimeout(300);
  const cfRow = p.locator(".overlay.open .cfrow").last();
  await cfRow.locator("input").nth(0).fill("Gate code");
  await cfRow.locator("input").nth(1).fill("4821");
  await cfRow.getByRole("button", { name: "Add" }).click();
  await p.waitForTimeout(400);
  await p.screenshot({ path: "/tmp/fix-3-customfield.png" });
  // after add: a readonly row labeled 'Gate code' with editable value '4821' should exist
  const roVal = await p.locator(".overlay.open .cfrow input.ro").last().inputValue().catch(() => "");
  const rows = await p.locator(".overlay.open .cfrow").count();
  log(`BUG3 custom-field: added readonly label='${roVal}' (expect 'Gate code'), cfrow count=${rows}`);
} catch (e) { log("BUG3 FAIL " + e.message.split("\n")[0]); }

await b.close();
