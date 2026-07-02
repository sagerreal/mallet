import { chromium } from "@playwright/test";
const base = "http://localhost:3000";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1512, height: 950 } });
const log = (s) => console.log("STEP:", s);

await p.goto(base + "/login", { waitUntil: "networkidle" });
await p.getByLabel("Email").fill("owner@e2e.mallet.test");
await p.getByLabel("Password").fill("e2e-password-1");
await p.getByRole("button", { name: "Sign in" }).click();
await p.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 30000 });
await p.goto(base + "/dashboard", { waitUntil: "networkidle" });
await p.waitForTimeout(900);

const crashed = await p.getByText("Something went wrong").count();
const hasTicket = await p.locator(".ticket h1").count();
const hasAtt = await p.locator("#attCard").count();
const attItems = await p.locator("#attCard .att-item").count();
const todayTasks = await p.locator(".card", { hasText: "Today" }).locator(".att-item").count();
await p.screenshot({ path: "/tmp/home-1.png", fullPage: true });
log(`dashboard: crashed=${crashed}, ticket=${hasTicket}, attention card=${hasAtt}, att items=${attItems}, today tasks=${todayTasks}`);

// attention action opens a modal (View lead / View quote)
const viewBtn = p.locator("#attCard").getByRole("button", { name: /View lead|View quote|View$/ }).first();
if (await viewBtn.count()) {
  await viewBtn.click();
  await p.waitForTimeout(500);
  const modalOpen = await p.locator(".overlay.open").count();
  log(`attention action opened a modal=${modalOpen > 0}`);
  await p.keyboard.press("Escape");
  await p.waitForTimeout(300);
}

// Today task Done -> task removed
if (todayTasks > 0) {
  const doneBtn = p.locator(".card", { hasText: "Today" }).getByRole("button", { name: "Done" }).first();
  await doneBtn.click();
  await p.waitForTimeout(400);
  const after = await p.locator(".card", { hasText: "Today" }).locator(".att-item").count();
  log(`Today task Done: ${todayTasks} -> ${after} (expect -1)`);
}

// attention dismiss (✕)
const before = await p.locator("#attCard .att-item").count();
const x = p.locator("#attCard .att-nn").first();
if (await x.count()) {
  await x.click();
  await p.waitForTimeout(300);
  const afterX = await p.locator("#attCard .att-item").count();
  log(`attention dismiss ✕: ${before} -> ${afterX} (expect -1)`);
}

await b.close();
