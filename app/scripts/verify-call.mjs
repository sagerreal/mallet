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
await p.goto(base + "/customers", { waitUntil: "networkidle" });
await p.waitForTimeout(1000);

// open Rob Alvarez -> Call sheet
await p.getByText("Rob Alvarez").first().click();
await p.waitForTimeout(400);
await p.getByRole("button", { name: /^Call/ }).click();
await p.waitForTimeout(400);
const paths = await p.locator(".overlay.open .pathpick2 .path").count();
await p.screenshot({ path: "/tmp/call-1-paths.png" });
log(`call sheet: path cards=${paths} (expect 2)`);

// Log a call form
await p.getByText("Log a call").click();
await p.waitForTimeout(300);
const hasDir = await p.locator(".overlay.open select").count();
await p.screenshot({ path: "/tmp/call-2-logform.png" });
log(`log form: selects=${hasDir} (expect 2: direction+when)`);
await p.keyboard.press("Escape");
await p.waitForTimeout(300);

// Call from Mallet -> global call bar
await p.getByText("Rob Alvarez").first().click();
await p.waitForTimeout(400);
await p.getByRole("button", { name: /^Call/ }).click();
await p.waitForTimeout(300);
await p.getByText("Call from Mallet").click();
await p.waitForTimeout(2200); // let the timer tick
const barOn = await p.locator("#callbar.on .cbar").isVisible().catch(() => false);
const timer = await p.locator("#callbar .cb-timer").innerText().catch(() => "?");
await p.screenshot({ path: "/tmp/call-3-livebar.png" });
log(`call bar live: visible=${barOn}, timer=${timer} (expect ~0:02)`);

// End call -> outcome chips -> finish
await p.getByRole("button", { name: "End call" }).click();
await p.waitForTimeout(300);
const chips = await p.locator("#callbar .chip").count();
await p.screenshot({ path: "/tmp/call-4-outcome.png" });
log(`ended: outcome chips=${chips} (expect 5)`);
await p.getByRole("button", { name: "Connected" }).click();
await p.waitForTimeout(400);
const barGone = await p.locator("#callbar.on").count();
log(`after finish: callbar.on count=${barGone} (expect 0 — logged + cleared)`);

await b.close();
