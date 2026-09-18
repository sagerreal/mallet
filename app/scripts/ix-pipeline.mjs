import { chromium } from "@playwright/test";
import { OWNER } from "./e2e-credentials.mjs";
const base="http://localhost:3000";
const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1512,height:950}});
await p.goto(base+"/login",{waitUntil:"networkidle"});
await p.getByLabel("Email").fill(OWNER.email); await p.getByLabel("Password").fill(OWNER.password);
await p.getByRole("button",{name:"Sign in"}).click(); await p.waitForURL("**/dashboard",{timeout:30000});
await p.goto(base+"/pipeline",{waitUntil:"networkidle"}); await p.waitForTimeout(1500);
await p.screenshot({path:"/tmp/p-pipeline.png"}); console.log("STEP pipeline shot");
// click a card → lead modal
await p.getByText("Tom Brennan").first().click(); await p.waitForTimeout(600);
const modal=await p.locator(".overlay.open, [role='dialog'], .modal").first().isVisible().catch(()=>false);
console.log("STEP card click → lead modal open="+modal);
await b.close();
