import { chromium } from "@playwright/test";
import { OWNER } from "./e2e-credentials.mjs";
const base = "http://localhost:3000";
const routes = [["/quotes","quotes"],["/pipeline","pipeline"],["/tasks","tasks"],["/composer","composer"],["/settings","settings"],["/messages","messages"],["/my-hours","myhours"]];
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1512, height: 950 } });
await p.goto(base + "/login", { waitUntil: "networkidle" });
await p.getByLabel("Email").fill(OWNER.email);
await p.getByLabel("Password").fill(OWNER.password);
await p.getByRole("button", { name: "Sign in" }).click();
await p.waitForURL("**/dashboard", { timeout: 30000 });
for (const [route, name] of routes) {
  try { await p.goto(base + route, { waitUntil: "networkidle" }); await p.waitForTimeout(1200); await p.screenshot({ path: `/tmp/sweep-${name}.png`, fullPage: true }); console.log("ok", route); }
  catch (e) { console.log("FAIL", route, e.message.split("\n")[0]); }
}
await b.close();
