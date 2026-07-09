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

// --- Evisit modal: Rob Alvarez has a site visit; open lead -> visit card -> Open ---
await p.goto(base + "/customers", { waitUntil: "networkidle" });
await p.waitForTimeout(800);
await p.getByText("Rob Alvarez").first().click();
await p.waitForTimeout(500);
await p.locator(".overlay.open").getByRole("button", { name: "Open" }).first().click();
await p.waitForTimeout(500);
const dayField = await p.locator(".overlay.open input[type=date]").count();
const crewField = await p.locator(".overlay.open select").count();
const seeCust = await p.locator(".overlay.open").getByText("See customer").count();
await p.screenshot({ path: "/tmp/evisit-1.png", fullPage: true });
log(`evisit modal: date fields=${dayField}, crew select=${crewField}, See customer=${seeCust}`);
await p.keyboard.press("Escape");
await p.waitForTimeout(300);

// --- Job modal smartPanel + checklist ---
await p.goto(base + "/jobs", { waitUntil: "networkidle" });
await p.waitForTimeout(700);
// open a SCHEDULED job (has a crew) to exercise the dispatch hint; fall back to first
await p.locator("table tbody tr.clickable").first().click();
await p.waitForTimeout(500);
const smart = await p.locator(".overlay.open .smartwrap, .overlay.open .smartsug").count();
const bestFit = await p.locator(".overlay.open").getByText(/Best fit|Assign/).count();
const checklist = await p.locator(".overlay.open").getByText(/Add a checklist/).count();
await p.screenshot({ path: "/tmp/evisit-2-jobsmart.png", fullPage: true });
log(`job modal: smartPanel nodes=${smart}, dispatch hint(Best fit/Assign)=${bestFit}, '+ Add a checklist'=${checklist}`);

await b.close();
