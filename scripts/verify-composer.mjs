import { chromium } from "@playwright/test";
const base = "http://localhost:3000";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1512, height: 950 } });
const log = (s) => console.log("STEP:", s);

async function login() {
  await p.goto(base + "/login", { waitUntil: "networkidle" });
  await p.getByLabel("Email").fill("owner@e2e.mallet.test");
  await p.getByLabel("Password").fill("e2e-password-1");
  await p.getByRole("button", { name: "Sign in" }).click();
  await p.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 30000 });
}
await login();

// baseline quote count
await p.goto(base + "/quotes", { waitUntil: "networkidle" });
await p.waitForTimeout(800);
const before = await p.locator("table tbody tr").count();
log(`quotes rows before: ${before}`);

// --- Builder render + Save draft persists a new quote ---
await p.goto(base + "/composer?lead=5", { waitUntil: "networkidle" });
await p.waitForTimeout(800);
const forWho = await p.locator(".sub").first().innerText().catch(() => "");
log(`composer header sub: '${forWho.replace(/\n/g, " ").trim()}'`);
const lineInputs = p.locator(".lineitems tbody tr").first().locator("input");
await lineInputs.nth(0).fill("Hydro-jet drain line");
await lineInputs.nth(2).fill("300");
await p.waitForTimeout(200);
await p.screenshot({ path: "/tmp/comp-1-builder.png", fullPage: true });
await p.getByRole("button", { name: "Save draft" }).click();
await p.waitForURL("**/quotes", { timeout: 10000 }).catch(() => {});
await p.waitForTimeout(800);
const afterDraft = await p.locator("table tbody tr").count();
log(`after Save draft: URL=${new URL(p.url()).pathname}, quotes rows=${afterDraft} (expect ${before + 1})`);

// --- Send quote -> creates sent quote + lands on pipeline ---
await p.goto(base + "/composer?lead=5", { waitUntil: "networkidle" });
await p.waitForTimeout(600);
const li2 = p.locator(".lineitems tbody tr").first().locator("input");
await li2.nth(0).fill("Water heater swap");
await li2.nth(2).fill("1650");
await p.waitForTimeout(150);
await p.getByRole("button", { name: "Send quote" }).click();
await p.waitForTimeout(1000);
log(`after Send quote: URL=${new URL(p.url()).pathname} (expect /pipeline)`);

// --- GBB: 3 options -> describe -> build -> review 3 tiers ---
await p.goto(base + "/composer?lead=5", { waitUntil: "networkidle" });
await p.waitForTimeout(600);
await p.getByRole("button", { name: /3 options/ }).click();
await p.waitForTimeout(300);
await p.locator("textarea").first().fill("40-gal water heater leaking, replace and haul away");
await p.getByRole("button", { name: "Build 3 options" }).click();
await p.waitForTimeout(500);
const tierCards = await p.locator(".ops-grid .card").count();
const recPill = await p.locator(".ops-grid .pill.green").count();
await p.screenshot({ path: "/tmp/comp-2-gbb.png", fullPage: true });
log(`GBB review: tier cards=${tierCards} (expect 3), recommended pills=${recPill} (expect 1)`);

// --- AI draft populates lines ---
await p.goto(base + "/composer?lead=5", { waitUntil: "networkidle" });
await p.waitForTimeout(600);
await p.getByRole("button", { name: /Draft with AI/ }).click();
await p.waitForTimeout(300);
await p.locator("textarea").first().fill("drain clog, hydro jet and camera");
await p.getByRole("button", { name: "Draft lines" }).click();
await p.waitForTimeout(400);
const lineCount = await p.locator(".lineitems tbody tr").count();
await p.screenshot({ path: "/tmp/comp-3-aidraft.png", fullPage: true });
log(`AI draft: line rows=${lineCount} (expect >=2, populated from template)`);

await b.close();
