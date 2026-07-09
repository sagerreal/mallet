import { chromium } from "@playwright/test";
const base = "http://localhost:3000";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1512, height: 950 } });
const log = (s) => console.log("STEP:", s);
async function login(){ await p.goto(base+"/login",{waitUntil:"networkidle"}); await p.getByLabel("Email").fill("owner@e2e.mallet.test"); await p.getByLabel("Password").fill("e2e-password-1"); await p.getByRole("button",{name:"Sign in"}).click(); await p.waitForURL(u=>!u.pathname.includes("/login"),{timeout:30000}); }
await login();

await p.goto(base+"/my-day",{waitUntil:"networkidle"}); await p.waitForTimeout(800);
const stops = p.locator(".md-stop");
const ns = await stops.count();
log(`my-day stops=${ns}`);
// mark the first stop done via its quick "✓ Done" button
const doneBtn = p.getByRole("button",{name:/✓ Done|Mark done/}).first();
if (await doneBtn.count()) { await doneBtn.click(); await p.waitForTimeout(400); }
// open the stop's tech job view
await stops.first().click(); await p.waitForTimeout(600);
const modal = p.locator(".overlay.open");
const hasDone = await modal.locator(".tjpaid").count();
await p.screenshot({path:"/tmp/closeout-doneblock.png"});
log(`done-block .tjpaid=${hasDone}`);
log("done-block text: "+(hasDone? (await modal.locator(".tjpaid").first().innerText()).replace(/\n+/g," | ").slice(0,200):"(none)"));

// open the close-out: click a take-payment / set-a-bill button
const payEntry = modal.getByRole("button",{name:/Take payment|Set a bill|Charge|Take payment another way/}).first();
if (await payEntry.count()) { await payEntry.click(); await p.waitForTimeout(600); }
const co = p.locator(".overlay.open");
const isWrap = await co.getByText(/Wrap up/).count();
await p.screenshot({path:"/tmp/closeout-wrapup.png"});
log(`close-out wrap-up=${isWrap}`);

// if bill-ask present (no price), set a flat bill
const setBill = co.getByRole("button",{name:/Set the bill/}).first();
if (await setBill.count()) {
  const amt = co.locator("input[type='number']").first();
  if (await amt.count()) { await amt.fill("240"); }
  await setBill.click(); await p.waitForTimeout(500);
  log("set flat bill $240");
}
// run the pay block: Cash → record → approve
const cash = co.getByRole("button",{name:/^Cash$/}).first();
if (await cash.count()) {
  await cash.click(); await p.waitForTimeout(400);
  const rec = p.locator(".overlay.open").getByRole("button",{name:/Record .*paid|Record cash/}).first();
  if (await rec.count()) { await rec.click(); await p.waitForTimeout(500); }
}
const approved = await p.locator(".overlay.open").getByText(/Approved/).count();
await p.screenshot({path:"/tmp/closeout-approved.png"});
log(`payment approved=${approved}`);
await b.close();
