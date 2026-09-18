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

// Jobs subs + no in-content strip
await p.goto(base + "/jobs", { waitUntil: "networkidle" });
await p.waitForTimeout(700);
const jsubs = (await p.locator(".sidebar .navsub").allInnerTexts()).map(s=>s.replace(/\s+/g," ").trim());
log("jobs subs: " + JSON.stringify(jsubs));
await p.locator(".sidebar .navsub", { hasText: "Schedule" }).click();
await p.waitForTimeout(600);
const jurl = new URL(p.url()); log("after Schedule: " + jurl.pathname + jurl.search);
const onBoard = await p.getByText("On the board").count();
const activeSub = (await p.locator(".sidebar .navsub.active").innerText().catch(()=>"")).trim();
log("schedule board visible=" + (onBoard>0) + ", active sub=" + activeSub);
await p.screenshot({ path: "/tmp/subnav-jobs.png" });

// Money subs
await p.goto(base + "/money", { waitUntil: "networkidle" });
await p.waitForTimeout(600);
const msubs = (await p.locator(".sidebar .navsub").allInnerTexts()).map(s=>s.trim());
log("money subs: " + JSON.stringify(msubs));
await p.locator(".sidebar .navsub", { hasText: "Invoices" }).click();
await p.waitForTimeout(600);
const murl = new URL(p.url());
const invList = await p.locator("h1", { hasText: "Invoices" }).count();
log("after Invoices: " + murl.pathname + murl.search + ", invoices view=" + (invList>0));
await b.close();
