import { chromium } from "@playwright/test";
import { OWNER } from "./e2e-credentials.mjs";
const base = "http://localhost:3000";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1512, height: 950 } });
const log = (s) => console.log("STEP:", s);

await p.goto(base + "/login", { waitUntil: "networkidle" });
await p.getByLabel("Email").fill(OWNER.email);
await p.getByLabel("Password").fill(OWNER.password);
await p.getByRole("button", { name: "Sign in" }).click();
await p.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 30000 });
await p.goto(base + "/money", { waitUntil: "networkidle" });
await p.waitForTimeout(800);
await p.screenshot({ path: "/tmp/money-1-dash.png", fullPage: true });

// --- Invoices list -> open an invoice modal ---
await p.getByRole("button", { name: "Invoices" }).first().click();
await p.waitForTimeout(400);
const rows = await p.locator("table tbody tr.clickable").count();
await p.locator("table tbody tr.clickable").first().click();
await p.waitForTimeout(500);
const h2 = await p.locator(".overlay.open h2").first().innerText().catch(() => "");
const hasTotal = await p.locator(".overlay.open").getByText(/Total|Due now|Paid in full/).count();
const takeBtn = await p.locator(".overlay.open").getByRole("button", { name: /Take payment|Send invoice/ }).count();
await p.screenshot({ path: "/tmp/money-2-invoice.png", fullPage: true });
log(`invoices rows=${rows}; invoice modal: customer='${h2}', total/due line=${hasTotal}, take/send btn=${takeBtn}`);
await p.keyboard.press("Escape");
await p.waitForTimeout(300);

// --- Take a payment on an unpaid invoice (find one with a "Take payment" button on the dashboard) ---
await p.getByRole("button", { name: "Money" }).first().click();
await p.waitForTimeout(400);
const takePayCards = await p.locator("main").getByRole("button", { name: /Take payment/ }).count();
if (takePayCards > 0) {
  await p.locator("main").getByRole("button", { name: /Take payment/ }).first().click();
  await p.waitForTimeout(500);
  // in the modal, open the take-payment sheet + record
  const dueBtn = p.locator(".overlay.open").getByRole("button", { name: /Take payment/ });
  if (await dueBtn.count()) { await dueBtn.first().click(); await p.waitForTimeout(300); }
  const recordBtn = p.locator(".overlay.open").getByRole("button", { name: /Record payment/ });
  const hadRecord = await recordBtn.count();
  if (hadRecord) {
    await recordBtn.first().click();
    await p.waitForTimeout(400);
  }
  await p.screenshot({ path: "/tmp/money-3-payment.png", fullPage: true });
  const paidNow = await p.locator(".overlay.open").getByText(/Paid in full|payments so far|Part-paid/).count();
  log(`take-payment: dashboard cards=${takePayCards}, Record btn=${hadRecord}, after record shows paid/partial=${paidNow}`);
} else {
  log(`take-payment: no 'Take payment' cards on the dashboard (all paid?)`);
}

// --- Ready to bill: Create invoice from a done job (if any) ---
const createBtns = await p.locator("main").getByRole("button", { name: /Create invoice/ }).count();
if (createBtns > 0) {
  await p.locator("main").getByRole("button", { name: /Create invoice/ }).first().click();
  await p.waitForTimeout(500);
  const modalOpen = await p.locator(".overlay.open h2").count();
  log(`create-from-job: Create-invoice buttons=${createBtns}, invoice modal opened=${modalOpen > 0}`);
} else {
  log(`create-from-job: no Ready-to-bill jobs in sample`);
}

await b.close();
