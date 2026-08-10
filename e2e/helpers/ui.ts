/**
 * e2e/helpers/ui.ts
 * Shared plumbing for the UI safety net: login, theme control, and the
 * determinism shims that let screenshots be compared across days.
 */

import type { Page, Locator } from "@playwright/test";

// Fixture credentials for the shared E2E org, environment-overridable so a rotation is a config
// change rather than a code change — and so the live password never lands in the repository.
//
// WHY THIS EXISTS: owner@e2e.mallet.test was reset through the Supabase admin API on 2026-08-04
// during a manual money-flow walkthrough. The literal below went stale that day and every visual
// and a11y run has died at the login step since, with "Email or password is incorrect" — the
// pre-merge gate for pixels and axe silently down, in a way that reads like a broken app.
//
// To run the nets: export E2E_OWNER_PASSWORD with the current value — which also tells
// `npm run seed:e2e:reset-passwords` to leave this account alone — or, if the rotation was
// accidental, run that script to put the literal below back.
export const OWNER = {
  email: process.env.E2E_OWNER_EMAIL ?? "owner@e2e.mallet.test",
  password: process.env.E2E_OWNER_PASSWORD ?? "e2e-password-1",
};
export const TECH = {
  email: process.env.E2E_TECH_EMAIL ?? "tech@e2e.mallet.test",
  password: process.env.E2E_TECH_PASSWORD ?? "e2e-password-1",
};
/**
 * The owner of the DELIBERATELY EMPTY org ("E2E Fresh Plumbing"), provisioned by the standard
 * `npm run seed:e2e` (and on its own by `npm run seed:e2e:empty`). The only account that can see
 * a first-run screen: OWNER's org accumulates a customer, a quote, a job and a bill on every
 * golden-path run, and the first-run board renders only for a shop with nothing open and no won
 * history.
 */
export const FRESH_OWNER = {
  email: process.env.E2E_FRESH_EMAIL ?? "owner@e2e-fresh.mallet.test",
  password: process.env.E2E_FRESH_PASSWORD ?? "e2e-password-1",
};

/** The instant every visual run pretends it is: 2025-07-15T12:00:00Z. */
const FROZEN_MS = 1_752_580_800_000;

/** Sign in through the real form and wait for the app shell. */
export async function login(page: Page, who: { email: string; password: string }): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password").fill(who.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/(dashboard|my-day|welcome)/, { timeout: 30_000 });
}

/**
 * Freeze the clock and pin the theme BEFORE the app boots.
 *
 * The clock freeze is what lets visual baselines survive to tomorrow: the app
 * renders "WED, JUL 8"-style labels and day-count ages straight from Date, so an
 * unfrozen run would diff every single morning.
 */
export async function prepare(page: Page, theme: "light" | "dark"): Promise<void> {
  await page.addInitScript(
    ({ theme: themeName, frozen }: { theme: string; frozen: number }) => {
      window.localStorage.setItem("mallet-theme", themeName);
      document.documentElement.setAttribute("data-theme", themeName);

      const OriginalDate = Date;
      class FrozenDate extends OriginalDate {
        constructor(...args: unknown[]) {
          // `new Date()` yields the frozen instant; every other form is untouched.
          if (args.length === 0) super(frozen);
          else super(...(args as [number]));
        }
        static now(): number {
          return frozen;
        }
      }
      window.Date = FrozenDate as unknown as DateConstructor;
    },
    { theme, frozen: FROZEN_MS },
  );
}

/** Wait for the app to settle: network quiet, fonts loaded, hydrators done. */
export async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.evaluate(() => document.fonts?.ready);
  // Hydrators fill the Zustand store client-side; give them a beat past networkidle.
  await page.waitForTimeout(600);

  // Scroll-prime: a fullPage screenshot of a very long list (e.g. /money mobile)
  // was flaking — content below the initial viewport rendered in the next/font
  // fallback face and only swapped to the real face when the capture scrolled it
  // into view, so its glyph edges differed run-to-run. Walk the whole page once
  // to force every row to render + swap fonts, then wait for fonts.ready again.
  await page.evaluate(async () => {
    const step = window.innerHeight;
    for (let y = 0; y <= document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => requestAnimationFrame(r));
    }
    window.scrollTo(0, 0);
  });
  await page.evaluate(() => document.fonts?.ready);
  await page.waitForTimeout(300);
}

/**
 * Regions that stay non-deterministic even with a frozen clock (live relative
 * labels, generated ids). Masked in screenshots rather than asserted.
 *
 * Correct for FULL-PAGE shots. Do not use it for an element-clipped shot — see
 * `dynamicRegionsIn` for why.
 */
export function dynamicRegions(page: Page): Locator[] {
  return [page.locator("[data-dynamic]")];
}

/**
 * The same masking, scoped to the element being shot.
 *
 * A page-wide mask locator is wrong for an element-clipped screenshot: Playwright
 * paints every match at its PAGE coordinates, so `[data-dynamic]` nodes sitting
 * BEHIND a modal get painted into the modal's image. Measured on new-customer at
 * 1280×900: the dialog occupies [330,40 620×621] and contains zero `[data-dynamic]`
 * nodes, yet two dashboard nodes — an `h1` at y=185 and a `span.muted` at y=522 —
 * landed inside that rectangle and covered the Phone field and the "More details"
 * row with mask bands.
 *
 * Two consequences, both bad: real modal content was never actually asserted where a
 * band fell, and the baseline drifted whenever the dashboard's live content changed
 * height, since that moves the bands. Scoping to the shot element fixes both.
 */
export function dynamicRegionsIn(scope: Locator): Locator[] {
  return [scope.locator("[data-dynamic]")];
}
