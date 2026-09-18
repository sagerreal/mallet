import { chromium } from "@playwright/test";
import { OWNER } from "./e2e-credentials.mjs";
const base = "http://localhost:3000";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1512, height: 1100 } });
await p.goto(base + "/login", { waitUntil: "networkidle" });
await p.getByLabel("Email").fill(OWNER.email);
await p.getByLabel("Password").fill(OWNER.password);
await p.getByRole("button", { name: "Sign in" }).click();
await p.waitForURL("**/dashboard", { timeout: 30000 });
await p.goto(base + "/customers", { waitUntil: "networkidle" });
await p.waitForTimeout(1200);
// lead modal
await p.getByText("Janet Kim").first().click();
await p.waitForTimeout(700);
await p.screenshot({ path: "/tmp/m-lead.png" });
console.log("STEP lead modal shot");
// close (Esc or the ✕)
await p.keyboard.press("Escape").catch(()=>{});
await p.waitForTimeout(300);
// new customer modal
await p.locator(".quickadd-btn").first().click(); await p.waitForTimeout(300);
await p.getByText("New customer").first().click(); await p.waitForTimeout(600);
await p.screenshot({ path: "/tmp/m-newcust.png" });
console.log("STEP new-customer modal shot");
// expand reveals
try { await p.getByText(/Book a visit/i).first().click(); await p.waitForTimeout(250); } catch(e){ console.log("no book-a-visit"); }
try { await p.getByText(/More details/i).first().click(); await p.waitForTimeout(250); } catch(e){ console.log("no more-details"); }
await p.screenshot({ path: "/tmp/m-newcust-expanded.png" });
console.log("STEP new-customer expanded shot");
await b.close();
