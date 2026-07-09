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
await p.waitForTimeout(1000);

const jobRows = await p.locator("table tbody tr.clickable").count();
log(`jobs list rows: ${jobRows}`);

// open the first job row -> job modal
await p.locator("table tbody tr.clickable").first().click();
await p.waitForTimeout(500);
const modalOpen = await p.locator(".overlay.open").isVisible().catch(() => false);
const h2 = await p.locator(".overlay.open h2").first().innerText().catch(() => "");
const hasSchedule = await p.locator(".overlay.open h3", { hasText: "Schedule" }).count();
const hasCall = await p.locator(".overlay.open").getByRole("button", { name: "Call" }).count();
const hasDone = await p.locator(".overlay.open").getByRole("button", { name: "Done" }).count();
await p.screenshot({ path: "/tmp/job-1-modal.png", fullPage: true });
log(`job modal: open=${modalOpen}, customer='${h2}', Schedule section=${hasSchedule}, Call btn=${hasCall}, Done btn=${hasDone}`);

// count visit rows, then + Add a visit -> a "Not placed" row appears
const visitsBefore = await p.locator(".overlay.open").getByText(/Not placed|remove visit/).count();
await p.locator(".overlay.open").getByRole("button", { name: "+ Add a visit" }).click();
await p.waitForTimeout(400);
const notPlaced = await p.locator(".overlay.open").getByText("Not placed").count();
await p.screenshot({ path: "/tmp/job-2-addvisit.png", fullPage: true });
log(`after + Add a visit: 'Not placed' rows=${notPlaced} (expect >=1)`);

// edit the job title -> store update (reopen check via title input value)
const titleInput = p.locator(".overlay.open .field label", { hasText: "Job" }).locator("xpath=following-sibling::input").first();
await titleInput.fill("Edited job title ZZZ");
await titleInput.blur();
await p.waitForTimeout(300);
log(`title edit applied (value now '${await titleInput.inputValue()}')`);

await b.close();
