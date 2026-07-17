/** D2 copilot screenshots — minimal deterministic flow (T6-proven placement path). */
import { test, type Page } from "@playwright/test";
import * as fs from "node:fs";

const DIR = "/tmp/d2shot/final";
const BASE = "http://localhost:3002";
fs.mkdirSync(DIR, { recursive: true });
test.setTimeout(300_000);

async function login(page: Page, email: string, dest: string) {
  await page.goto(`${BASE}/login`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("e2e-password-1");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(`**${dest}`, { timeout: 30_000 });
  await page.waitForTimeout(2000);
}

test("copilot states", async ({ browser }) => {
  // 1) owner placement already done in a prior run (visit persisted)

  // 2) TECH: open my-day → job card → the modal + copilot section
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await login(page, "tech@e2e.mallet.test", "/my-day");
  await page.screenshot({ path: `${DIR}/1-myday.png` });
  await page.locator(".md-stop").first().click();
  await page.waitForTimeout(1500);
  const copilot = page.locator(".fsec", { hasText: "Copilot" }).first();
  await copilot.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${DIR}/2-copilot-idle.png` });

  // 3) Ask a question (real LLM if key present)
  const input = page.getByPlaceholder(/ask the copilot/i);
  await input.fill("the expansion tank is completely corroded and dead — what should I do about it?");
  await copilot.locator("button", { hasText: /^Ask$/i }).click();
  await page.waitForTimeout(400);
  await copilot.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${DIR}/3-copilot-pending.png` });
  // wait up to 60s for an answer or error to render
  await page.waitForFunction(
    () => {
      const sec = [...document.querySelectorAll(".fsec")].find((s) => s.textContent?.includes("Copilot"));
      return sec && !/thinking|…$/i.test(sec.textContent ?? "") && (sec.textContent?.length ?? 0) > 200;
    },
    { timeout: 90_000 },
  ).catch(() => null);
  await copilot.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${DIR}/4-copilot-answer.png`, fullPage: false });

  // 4) If a FOUND WORK card rendered, tap Add to found work
  const addBtn = copilot.locator("button", { hasText: /add to found work/i }).first();
  if (await addBtn.count()) {
    await addBtn.click();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${DIR}/5-added.png` });
  }
  await ctx.close();
});
