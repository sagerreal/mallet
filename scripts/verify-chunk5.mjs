import { chromium } from "@playwright/test";
const base = "http://localhost:3000";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1512, height: 950 } });
const log = (s) => console.log("STEP:", s);
await p.goto(base+"/login",{waitUntil:"networkidle"});
await p.getByLabel("Email").fill("owner@e2e.mallet.test"); await p.getByLabel("Password").fill("e2e-password-1");
await p.getByRole("button",{name:"Sign in"}).click(); await p.waitForURL(u=>!u.pathname.includes("/login"),{timeout:30000});

// open the (not-done) tech job view via My Day
await p.goto(base+"/my-day",{waitUntil:"networkidle"}); await p.waitForTimeout(800);
await p.locator(".md-stop").first().click(); await p.waitForTimeout(600);
const m = p.locator(".overlay.open");
const wo = await m.locator(".fsec-h", {hasText:"Work order"}).count();
const fw = await m.locator(".fsec-h", {hasText:"Found work"}).count();
log(`work-order fsec=${wo}, found-work fsec=${fw}`);
await p.screenshot({path:"/tmp/chunk5-techview.png"});

// found-work: add an addon
const descIn = m.locator("input[placeholder*='extra work'], input[placeholder*='found']").first();
if (await descIn.count()) {
  await descIn.fill("Replaced corroded angle stop");
  const priceIn = m.locator("input[placeholder*='price'], input[type='number']").last();
  if (await priceIn.count()) await priceIn.fill("140");
  await m.getByRole("button",{name:/^Add$/}).first().click(); await p.waitForTimeout(400);
}
const awaiting = await m.getByText(/awaiting OK/).count();
log(`addon awaiting-OK pills=${awaiting}`);
// approve it
const okd = m.getByRole("button",{name:/Customer OK/}).first();
if (await okd.count()) { await okd.click(); await p.waitForTimeout(400); }
const approved = await m.locator(".stpill", {hasText:"approved"}).count();
log(`addon approved pills=${approved}`);
await p.screenshot({path:"/tmp/chunk5-foundwork.png"});
await b.close();
