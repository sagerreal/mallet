import { chromium } from "@playwright/test";
const base = "http://localhost:3000";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1512, height: 950 } });
const log = (s) => console.log("STEP:", s);
async function login(){ await p.goto(base+"/login",{waitUntil:"networkidle"}); await p.getByLabel("Email").fill("owner@e2e.mallet.test"); await p.getByLabel("Password").fill("e2e-password-1"); await p.getByRole("button",{name:"Sign in"}).click(); await p.waitForURL(u=>!u.pathname.includes("/login"),{timeout:30000}); }
await login();

// --- My hours ---
await p.goto(base+"/my-hours",{waitUntil:"networkidle"}); await p.waitForTimeout(700);
const rows = await p.locator(".stage-row, .tsrow, tr").count();
const bodyText = (await p.locator("body").innerText()).slice(0,400);
await p.screenshot({path:"/tmp/my-hours.png", fullPage:false});
log(`my-hours: rows=${rows}`);
log("my-hours head: "+bodyText.replace(/\n+/g," | ").slice(0,240));

// --- Messages ---
await p.goto(base+"/messages",{waitUntil:"networkidle"}); await p.waitForTimeout(700);
const threadRows = await p.locator(".msgrow, .threadrow, [data-thread], .navsub, li").count();
await p.screenshot({path:"/tmp/messages.png", fullPage:false});
// try opening the first clickable thread
let opened = 0;
const clickables = p.locator("main .clickable, main [role='button'], main li");
const cn = await clickables.count();
for (let i=0;i<Math.min(cn,8);i++){
  await clickables.nth(i).click().catch(()=>{});
  await p.waitForTimeout(350);
  if (await p.locator(".overlay.open").count()) { opened=1; await p.screenshot({path:"/tmp/messages-thread.png"}); break; }
}
log(`messages: listItems=${threadRows}, threadModalOpened=${opened}`);
await b.close();
