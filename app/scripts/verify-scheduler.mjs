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

// switch to the Schedule sub-tab
await p.getByRole("button", { name: "Schedule" }).first().click();
await p.waitForTimeout(500);
const trayBefore = await p.locator(".railjob").count();
log(`to-schedule tray cards: ${trayBefore}`);

// arm the first tray job
await p.locator(".railjob").first().getByRole("button", { name: "Schedule" }).click();
await p.waitForTimeout(400);
const armedBar = await p.getByText(/Tap a crew .* time on the board/).isVisible().catch(() => false);
const dropCells = await p.locator(".gv-cell.drop").count();
const btnCancel = await p.locator(".railjob").first().getByRole("button", { name: "Cancel" }).count();
await p.screenshot({ path: "/tmp/sched-1-armed.png", fullPage: true });
log(`armed: instruction bar=${armedBar}, drop cells lit=${dropCells}, tray btn shows Cancel=${btnCancel}`);

// tap a board cell to place it
const blocksBefore = await p.locator(".gv-block").count();
await p.locator(".gv-cell.drop").nth(20).click();
await p.waitForTimeout(500);
const trayAfter = await p.locator(".railjob").count();
const blocksAfter = await p.locator(".gv-block").count();
await p.screenshot({ path: "/tmp/sched-2-placed.png", fullPage: true });
log(`after cell tap: tray ${trayBefore}->${trayAfter} (expect -1), board blocks ${blocksBefore}->${blocksAfter} (expect +1)`);

await b.close();
