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
await p.waitForTimeout(1200);
const rowsBefore = await p.locator("table tbody tr, .lead-row, [data-lead-row]").count().catch(() => -1);
log("customer rows before: " + rowsBefore);
// 1. + New menu
try { await p.locator(".navnew").first().click(); await p.waitForTimeout(400); await p.screenshot({ path: "/tmp/ix-1-newmenu.png" }); log("clicked +New; 'New customer' visible=" + await p.getByText("New customer").first().isVisible()); } catch(e){ log("newmenu FAIL " + e.message.split("\n")[0]); }
// 2. New customer modal
try { await p.getByText("New customer").first().click(); await p.waitForTimeout(500); await p.screenshot({ path: "/tmp/ix-2-newcustomer-modal.png" }); log("opened New customer modal"); } catch(e){ log("open modal FAIL " + e.message.split("\n")[0]); }
// 3. fill + create
try {
  const inputs = p.locator(".overlay.open input, [role='dialog'] input, .modal input");
  await inputs.first().fill("Ziggy Testcase");
  if (await inputs.count() > 1) await inputs.nth(1).fill("(925) 555-9999");
  await p.getByRole("button", { name: /create|add|save/i }).first().click();
  await p.waitForTimeout(700);
  await p.screenshot({ path: "/tmp/ix-3-after-create.png" });
  log("created; 'Ziggy Testcase' in list=" + await p.getByText("Ziggy Testcase").first().isVisible().catch(()=>false));
} catch(e){ log("create FAIL " + e.message.split("\n")[0]); }
// 4. click a customer row → lead modal
try {
  await p.getByText("Janet Kim").first().click();
  await p.waitForTimeout(500);
  await p.screenshot({ path: "/tmp/ix-4-lead-modal.png" });
  const modalOpen = await p.locator(".overlay.open, [role='dialog'], .modal").first().isVisible().catch(()=>false);
  log("clicked Janet Kim; modal open=" + modalOpen);
} catch(e){ log("lead modal FAIL " + e.message.split("\n")[0]); }
await b.close();
