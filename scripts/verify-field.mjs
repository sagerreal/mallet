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
// field reachable from sidebar
await p.goto(base + "/my-day", { waitUntil: "networkidle" });
await p.waitForTimeout(800);
const crashed = await p.getByText("Something went wrong").count();
const h1 = await p.locator("h1", { hasText: "My day" }).count();
// find a tech with stops
let stops = await p.locator(".md-stop").count();
if (stops === 0) {
  const chips = await p.locator(".chips .chip").count();
  for (let i = 0; i < chips; i++) {
    await p.locator(".chips .chip").nth(i).click();
    await p.waitForTimeout(300);
    stops = await p.locator(".md-stop").count();
    if (stops > 0) break;
  }
}
log(`my-day: crashed=${crashed}, h1=${h1}, stops=${stops}`);
await p.screenshot({ path: "/tmp/field-1-myday.png", fullPage: true });
if (stops > 0) {
  await p.locator(".md-stop").first().click();
  await p.waitForTimeout(500);
  const modal = await p.locator(".overlay.open").count();
  const timer = await p.locator(".overlay.open .tjclock").count();
  const visitSec = await p.locator(".overlay.open .fsec").count();
  const priceBtn = await p.locator(".overlay.open").getByText(/Price it on site|Priced|Scoping/).count();
  await p.screenshot({ path: "/tmp/field-2-techjob.png", fullPage: true });
  log(`tech job view: modal=${modal}, field timer(.tjclock)=${timer}, .fsec sections=${visitSec}, pricing=${priceBtn}`);
  // start the field timer
  if (timer > 0) {
    await p.locator(".overlay.open .tjclock").first().click();
    await p.waitForTimeout(1600);
    const running = await p.locator(".overlay.open .tjclock.run").count();
    const t = await p.locator(".overlay.open .tjclock-time").first().innerText().catch(()=>"?");
    log(`field timer started: running=${running}, elapsed='${t}'`);
  }
}
await b.close();
