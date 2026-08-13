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
await p.goto(base + "/quotes", { waitUntil: "networkidle" });
await p.waitForTimeout(1000);

// 1. open a SENT quote -> estimate modal with lines + follow-up trail
await p.getByText("Kitchen drain + cleanout").first().click();
await p.waitForTimeout(500);
const lineRows = await p.locator(".overlay.open table tbody tr").count();
const hasTrail = await p.locator(".overlay.open .trail").count();
const totalCell = await p.locator(".overlay.open table tbody tr").last().innerText().catch(() => "");
await p.screenshot({ path: "/tmp/est-1-sent.png" });
log(`SENT quote: table rows=${lineRows} (lines+pricing), follow-up trail=${hasTrail} (expect 1), total row='${totalCell.replace(/\n/g, " ")}'`);
await p.keyboard.press("Escape");
await p.waitForTimeout(300);

// 2. open a DRAFT quote -> Send quote, then verify status flips to Sent in the list
await p.getByText("Two toilet replacements").first().click();
await p.waitForTimeout(400);
const hasSend = await p.getByRole("button", { name: "Send quote" }).isVisible().catch(() => false);
await p.screenshot({ path: "/tmp/est-2-draft.png" });
log(`DRAFT quote: 'Send quote' button visible=${hasSend}`);
await p.getByRole("button", { name: "Send quote" }).click();
await p.waitForTimeout(500);
// row for Q-1044 should now show a Sent stamp (was Draft)
const row1044 = p.locator("tr", { hasText: "Two toilet replacements" });
const stampText = await row1044.locator(".stamp").innerText().catch(() => "?");
log(`after Send: Q-1044 list stamp='${stampText}' (expect Sent)`);

// 3. open an ACCEPTED quote -> Delete arms two-tap with WON warning
await p.getByText("Whole-house PEX repipe").first().click();
await p.waitForTimeout(400);
await p.getByRole("button", { name: "Delete quote" }).click();
await p.waitForTimeout(300);
const armed = await p.getByRole("button", { name: "Yes, delete" }).isVisible().catch(() => false);
const warn = await p.getByText(/WON quote/).isVisible().catch(() => false);
await p.screenshot({ path: "/tmp/est-3-delete-arm.png" });
log(`ACCEPTED quote delete: armed 'Yes, delete'=${armed}, WON warning shown=${warn}`);

await b.close();
