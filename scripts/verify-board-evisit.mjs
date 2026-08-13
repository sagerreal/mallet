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
await p.getByRole("button", { name: "Schedule" }).first().click();
await p.waitForTimeout(500);

// estimate visits (dashed .est blocks) now render on the board
const estBlocks = await p.locator(".gv-block.est").count();
const jobBlocks = await p.locator(".gv-block").count();
await p.screenshot({ path: "/tmp/board-evisit-1.png", fullPage: true });
log(`board blocks total=${jobBlocks}, estimate (.est) blocks=${estBlocks} (expect >=1)`);

// clicking an estimate block opens the office Evisit modal
if (estBlocks > 0) {
  await p.locator(".gv-block.est").first().click();
  await p.waitForTimeout(500);
  const isEvisit = await p.locator(".overlay.open").getByText(/Estimate visit/i).count();
  const hasSched = await p.locator(".overlay.open input[type=date]").count();
  await p.screenshot({ path: "/tmp/board-evisit-2-modal.png", fullPage: true });
  log(`clicked estimate block: Evisit modal (Estimate visit label=${isEvisit}, date field=${hasSched})`);
}

await b.close();
