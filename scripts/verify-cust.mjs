import { chromium } from "@playwright/test";
const base = "http://localhost:3000";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1512, height: 950 } });
const log = (s) => console.log("STEP:", s);
async function login(){ await p.goto(base+"/login",{waitUntil:"networkidle"}); await p.getByLabel("Email").fill("owner@e2e.mallet.test"); await p.getByLabel("Password").fill("e2e-password-1"); await p.getByRole("button",{name:"Sign in"}).click(); await p.waitForURL(u=>!u.pathname.includes("/login"),{timeout:30000}); }
await login();
// customer quote page
await p.goto(base+"/quotes",{waitUntil:"networkidle"}); await p.waitForTimeout(700);
await p.getByText("Two toilet replacements").first().click(); await p.waitForTimeout(400);
await p.locator(".overlay.open").getByRole("button",{name:"Preview as customer"}).click(); await p.waitForTimeout(500);
const qHead = await p.locator(".overlay.open .custhead").count();
const qApprove = await p.locator(".overlay.open").getByRole("button",{name:/Approve/}).count();
const qLines = await p.locator(".overlay.open .custline").count();
await p.screenshot({path:"/tmp/cust-quote.png"});
log(`cust quote page: custhead=${qHead}, custlines=${qLines}, Approve btn=${qApprove}`);
await p.keyboard.press("Escape"); await p.waitForTimeout(300);
// customer invoice page (unpaid) via Money -> Invoices
await p.goto(base+"/money?tab=fin-invoices",{waitUntil:"networkidle"}); await p.waitForTimeout(700);
// find an unpaid invoice row (Due > 0) -> open modal
const rows = p.locator("table tbody tr.clickable");
const n = await rows.count();
for (let i=0;i<n;i++){ await rows.nth(i).click(); await p.waitForTimeout(400);
  const prev = p.locator(".overlay.open").getByRole("button",{name:"Preview as customer"});
  if (await prev.count()) { await prev.click(); await p.waitForTimeout(500); break; }
  await p.keyboard.press("Escape"); await p.waitForTimeout(200);
}
const iHead = await p.locator(".overlay.open .custhead").count();
const iPay = await p.locator(".overlay.open").getByRole("button",{name:/Pay/}).count();
const iPaid = await p.locator(".overlay.open").getByText(/Paid in full|Settled/).count();
await p.screenshot({path:"/tmp/cust-invoice.png"});
log(`cust invoice page: custhead=${iHead}, Pay btn=${iPay}, paid/settled=${iPaid}`);
await b.close();
