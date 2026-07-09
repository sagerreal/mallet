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
await p.goto(base + "/jobs", { waitUntil: "networkidle" });
await p.waitForTimeout(900);

const before = await p.locator("table tbody tr.clickable").count();
log(`jobs rows before: ${before}`);

// --- New job modal: open, fill, create -> row appears (store-backed page) ---
await p.getByRole("button", { name: /New job/ }).first().click();
await p.waitForTimeout(500);
const njFields = await p.locator(".overlay.open .field").count();
const njChips = await p.locator(".overlay.open .chip").count();
await p.screenshot({ path: "/tmp/jobs-1-newjob.png", fullPage: true });
log(`new-job modal: fields=${njFields}, type chips=${njChips}`);
await p.locator(".overlay.open input").first().fill("Sump pump replacement ZZZ");
await p.getByRole("button", { name: /Create job/ }).click();
await p.waitForTimeout(600);
const afterCreate = await p.locator("table tbody tr.clickable").count();
const foundNew = await p.getByText("Sump pump replacement ZZZ").count();
log(`after Create: rows=${afterCreate} (expect ${before + 1}), new job visible=${foundNew}`);

// --- Job sweep: open, archive one -> row leaves the list ---
await p.getByRole("button", { name: /Clean up/ }).click();
await p.waitForTimeout(400);
const title = await p.getByText("Clean up jobs").first().isVisible().catch(() => false);
const groups = await p.locator(".overlay.open .navlabel").count();
const boxes = await p.locator(".overlay.open .sweeprow input[type=checkbox]").count();
const actions = await p.locator(".overlay.open").getByRole("button", { name: /Delete checked|Archive checked/ }).count();
await p.screenshot({ path: "/tmp/jobs-2-sweep.png", fullPage: true });
log(`job sweep: title=${title}, groups=${groups}, checkboxes=${boxes}, actionBtns=${actions}`);
await p.locator(".overlay.open .sweeprow input[type=checkbox]").first().check();
await p.getByRole("button", { name: "Archive checked" }).click();
await p.waitForTimeout(500);
const afterArchive = await p.locator("table tbody tr.clickable").count();
log(`after Archive one: rows ${afterCreate} -> ${afterArchive} (expect ${afterCreate - 1})`);

await b.close();
