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
await p.waitForTimeout(700);

// --- Timesheets: tab -> add entry -> approve ---
await p.getByRole("button", { name: "Timesheets" }).first().click();
await p.waitForTimeout(400);
const addBtn = await p.getByRole("button", { name: /Add entry/ }).count();
await p.getByRole("button", { name: /Add entry/ }).first().click();
await p.waitForTimeout(400);
await p.screenshot({ path: "/tmp/lo-1-timesheets.png", fullPage: true });
const approveBtn = await p.getByRole("button", { name: /^Approve/ }).count();
log(`timesheets: +Add entry btn=${addBtn}, entry added, Approve btn=${approveBtn}`);

// --- Checklist templates manager ---
await p.getByRole("button", { name: "Jobs" }).first().click();
await p.waitForTimeout(300);
await p.getByRole("button", { name: /Checklist templates/ }).click();
await p.waitForTimeout(400);
const stdTitle = await p.getByText("Checklist templates").nth(1).isVisible().catch(() => false);
const cards = await p.locator(".overlay.open .card").count();
await p.screenshot({ path: "/tmp/lo-2-standards.png", fullPage: true });
log(`standards modal: title=${stdTitle}, checklist cards=${cards} (expect >=2 templates + new)`);
await p.keyboard.press("Escape");
await p.waitForTimeout(300);

// --- Job-modal: attach a checklist ---
await p.locator("table tbody tr.clickable").first().click();
await p.waitForTimeout(400);
await p.locator(".overlay.open").getByText("+ Add a checklist").click();
await p.waitForTimeout(300);
const tplRows = await p.locator(".overlay.open .stage-row.clickable").count();
await p.locator(".overlay.open .stage-row.clickable").first().click();
await p.waitForTimeout(300);
const attached = await p.locator(".overlay.open").getByText("Before you leave").count();
await p.screenshot({ path: "/tmp/lo-3-attach.png", fullPage: true });
log(`job checklist attach: template rows=${tplRows}, attached 'Before you leave'=${attached}`);

await b.close();
