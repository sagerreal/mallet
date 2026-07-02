import { chromium } from "@playwright/test";
const base = "http://localhost:3000";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1512, height: 950 } });
const log = (s) => console.log("STEP:", s);

await p.goto(base + "/login", { waitUntil: "networkidle" });
await p.getByLabel("Email").fill("owner@e2e.mallet.test");
await p.getByLabel("Password").fill("e2e-password-1");
await p.getByRole("button", { name: "Sign in" }).click();
await p.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 30000 });
await p.goto(base + "/quotes", { waitUntil: "networkidle" });
await p.waitForTimeout(800);
const before = await p.locator("table tbody tr").count();

await p.getByRole("button", { name: /Clean up/ }).click();
await p.waitForTimeout(400);
const title = await p.getByText("Clean up quotes").first().isVisible().catch(() => false);
const groups = await p.locator(".overlay.open .navlabel").count();
const boxes = await p.locator(".overlay.open .sweeprow input[type=checkbox]").count();
const actions = await p.locator(".overlay.open").getByRole("button", { name: /Delete checked|Archive checked/ }).count();
await p.screenshot({ path: "/tmp/qsweep-1.png" });
log(`quote sweep: title=${title}, groups=${groups}, checkboxes=${boxes}, actionBtns=${actions} (expect 2)`);

// archive the first checkbox -> quote leaves the list
await p.locator(".overlay.open .sweeprow input[type=checkbox]").first().check();
await p.getByRole("button", { name: "Archive checked" }).click();
await p.waitForTimeout(500);
const after = await p.locator("table tbody tr").count();
log(`after archive one: quotes rows ${before} -> ${after} (expect ${before - 1})`);

await b.close();
