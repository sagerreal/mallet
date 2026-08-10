/**
 * e2e/first-run.spec.ts
 * DAY ONE ON THE WORK BOARD — the screen a shop meets before it has any work.
 *
 * Runs against its OWN org. "E2E Plumbing" cannot serve here: the golden path adds a customer, a
 * quote, a job and a bill to it on every run, and the first-run board renders only for a shop with
 * nothing open AND no won history (the wonCount guard in app/(office)/dashboard/page.tsx). So this
 * spec logs in as the owner of "E2E Fresh Plumbing", provisioned by:
 *
 *     npm run seed:e2e:empty
 *
 * Nothing in this file writes. If it starts failing on "0 ghosts", the fixture org has grown work
 * — the seed script prints a warning when it has — and the fix is to find what wrote to it, not to
 * loosen the assertion.
 */

import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { login, prepare, settle, dynamicRegions, FRESH_OWNER } from "./helpers/ui";

/** The word every drawn card is tagged with (features/board/ghosts GHOST_TAG). */
const GHOST_TAG = "Example";

/** The three ways in, in the order the setup brief offers them (dashboard/page.tsx FIRST_RUN). */
const SETUP_PATHS = [
  { title: "Import your customers", action: "Import" },
  { title: "Add your first job", action: "Add job" },
  { title: "Forward calls to Front Desk", action: "Set up" },
];

async function openFirstRunBoard(page: Page): Promise<void> {
  await login(page, FRESH_OWNER);
  await page.goto("/dashboard");
  await expect(page.locator('[role="status"][aria-busy="true"]')).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByRole("region", { name: /\bcolumn$/ })).toHaveCount(4, { timeout: 30_000 });
}

test.describe("a brand-new shop's first look at the board", () => {
  test.describe.configure({ mode: "serial" });

  test("four columns, each drawn with one EXAMPLE card", async ({ page }) => {
    await openFirstRunBoard(page);

    const ghosts = page.locator(".kcard.ghosted");
    await expect(ghosts).toHaveCount(4);

    // Every one of them is tagged, and every one is hidden from assistive tech: a screen reader
    // that read these out would be reading out four customers who do not exist.
    for (let i = 0; i < 4; i += 1) {
      await expect(ghosts.nth(i)).toContainText(GHOST_TAG);
      await expect(ghosts.nth(i)).toHaveAttribute("aria-hidden", "true");
    }

    // INERT IN THE MARKUP, not behind a disabled handler. Nothing to click, nothing the keyboard
    // can land on — a drawn card must not promise a record it has not got.
    const clickable = await ghosts.locator("a, button, [role='button'], [tabindex]").count();
    expect(clickable, "a drawn example card must hold nothing focusable").toEqual(0);

    // Every column head reads a hard 0 — the ghosts are drawings, not rows, and must not be counted.
    const figures = await page
      .locator("section.col > .col-head > .sum")
      .evaluateAll((els) => els.map((el) => (el.textContent ?? "").trim()));
    expect(figures).toEqual(["0", "0", "0", "0"]);
  });

  test("the setup brief replaces the hero with three real ways in", async ({ page }) => {
    await openFirstRunBoard(page);

    // The hero is GONE, not emptied: "Nothing's waiting on you. Go run the day." is true on day
    // one and teaches a new shop nothing.
    await expect(page.locator(".ticket")).toHaveCount(0);

    const brief = page.locator(".frs");
    await expect(brief).toBeVisible();
    await expect(brief.locator(".frs-path")).toHaveCount(SETUP_PATHS.length);

    for (const path of SETUP_PATHS) {
      const card = brief.locator(".frs-path", { hasText: path.title });
      await expect(card).toHaveCount(1);
      await expect(card.getByRole("button", { name: path.action, exact: true })).toBeVisible();
    }

    // Every path opens something real — the house rule forbids a dead button. The first one is a
    // modal, and it opens.
    await brief.getByRole("button", { name: "Import", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
  });

  test("no dollar figure anywhere on the first-run screen", async ({ page }) => {
    await openFirstRunBoard(page);

    // A dollar figure is the one thing on a card an owner reads as a fact about their own
    // business. Inventing one on day one would be a lie told in the app's own voice — so the
    // drawn cards carry no price and the column heads state 0 rather than $0.
    const text = await page.locator("body").innerText();
    expect(text, "the first-run screen must not state any money").not.toContain("$");
  });
});

/**
 * The pixels and the axe scan for this screen. Behind E2E_VISUAL like the other nets, and shot
 * here rather than added to e2e/helpers/routes.ts: the shared inventory is keyed by AUDIENCE
 * (office = OWNER), and adding a fourth audience for one screen would drag visual, a11y, keyboard
 * and both mobile specs into a fixture only this file needs.
 *
 * ⚠️ Re-baseline against a PRODUCTION build, like e2e/visual.spec.ts — never `next dev`.
 */
test.describe("first-run · nets", () => {
  test.skip(!process.env.E2E_VISUAL, "set E2E_VISUAL=1 to run the visual + axe nets");
  test.describe.configure({ mode: "serial" });

  for (const theme of ["light", "dark"] as const) {
    test(`office-today-first-run · ${theme} · desktop`, async ({ page }) => {
      await prepare(page, theme);
      await page.setViewportSize({ width: 1440, height: 900 });
      await openFirstRunBoard(page);
      await settle(page);
      await expect(page).toHaveScreenshot(`office-today-first-run-${theme}-desktop.png`, {
        fullPage: true,
        animations: "disabled",
        mask: dynamicRegions(page),
        maxDiffPixels: 150,
        timeout: 20_000,
      });
    });
  }

  test("axe · first-run board", async ({ page }) => {
    await prepare(page, "light");
    await page.setViewportSize({ width: 1440, height: 900 });
    await openFirstRunBoard(page);
    await settle(page);

    const scan = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    const ids = scan.violations.map((v) => `${v.id}(${v.nodes.length})`);
    expect(scan.violations.length, `axe violations: ${ids.join(", ")}`).toEqual(0);
  });
});
