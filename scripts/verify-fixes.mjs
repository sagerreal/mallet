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
await p.waitForTimeout(700);
// open a job modal, measure overlay coverage
await p.locator("table tbody tr.clickable").first().click();
await p.waitForTimeout(500);
const ov = await p.locator(".overlay.open").boundingBox();
const bodyMr = await p.evaluate(() => getComputedStyle(document.body).marginRight);
const overlayRight = await p.evaluate(() => {
  const el = document.querySelector(".overlay.open");
  return el ? getComputedStyle(el).right : "?";
});
log(`overlay box: left=${Math.round(ov.x)} width=${Math.round(ov.width)} (viewport 1512); overlay right=${overlayRight}; body margin-right=${bodyMr}`);
await p.screenshot({ path: "/tmp/fix-overlay.png" });
await b.close();
