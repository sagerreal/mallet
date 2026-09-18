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
await p.goto(base + "/jobs", { waitUntil: "networkidle" });
await p.waitForTimeout(800);

// open the first (priced) job, read its Total, click Edit -> price builder
await p.locator("table tbody tr.clickable").first().click();
await p.waitForTimeout(500);
await p.locator(".overlay.open").getByText("Edit").first().click();
await p.waitForTimeout(500);
const lineRows = await p.locator(".overlay.open .stage-row").count();
const hasSave = await p.locator(".overlay.open").getByRole("button", { name: /Save price/ }).count();
await p.getByRole("button", { name: /Add a line/ }).click();
await p.waitForTimeout(300);
const tiles = await p.locator(".overlay.open .addtile").count();
await p.screenshot({ path: "/tmp/price-1-builder.png", fullPage: true });
log(`price builder: line rows=${lineRows}, Save price btn=${hasSave}, add-tiles=${tiles} (expect 4)`);

// browse pricebook -> add an item -> Save price
await p.locator(".overlay.open .addtile").filter({ hasText: /Pricebook|saved items/i }).first().click();
await p.waitForTimeout(300);
const pbRows = await p.locator(".overlay.open .stage-row.clickable").count();
await p.locator(".overlay.open .stage-row.clickable").filter({ hasText: /City permit/ }).first().click();
await p.waitForTimeout(300);
const lineRows2 = await p.locator(".overlay.open .stage-row").filter({ has: p.locator("input") }).count();
log(`after pricebook add: browse rows=${pbRows}, editable line rows now=${lineRows2}`);
await p.getByRole("button", { name: /Save price/ }).click();
await p.waitForTimeout(500);

// reopen the job -> price summary should now include City permit + higher total
await p.locator("table tbody tr.clickable").first().click();
await p.waitForTimeout(500);
const permitInPrice = await p.locator(".overlay.open .card").filter({ hasText: "Price" }).getByText(/City permit/).count();
const totalText = await p.locator(".overlay.open .card").filter({ hasText: "Price" }).getByText(/Total/).textContent().catch(() => "");
await p.screenshot({ path: "/tmp/price-2-saved.png", fullPage: true });
log(`reopened job: 'City permit' in price card=${permitInPrice}, total row='${totalText?.trim()}'`);

await b.close();
