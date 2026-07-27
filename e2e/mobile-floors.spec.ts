/**
 * e2e/mobile-floors.spec.ts
 * The two ergonomic floors that decide whether this app is usable from a phone
 * held in one gloved hand on a job site. Both were measured as failing on
 * production before this net existed, so this is a regression gate, not a wish.
 *
 * FLOOR 1 — 16px text-entry minimum. iOS force-zooms the viewport whenever a
 * focused control computes under 16px, and does NOT zoom back out. Every field
 * tap became a pinch. 25 of 26 controls failed this.
 *
 * The cause was specificity, not a missing rule: prototype.css already carried a
 * mobile `input[type=text]{font-size:var(--type-lg)}` rule, but `.field
 * input[type=text]` at :798 scores (0,2,1) against its (0,1,1) and wins whatever
 * the source order. That is why the fix repeats the `.field` qualifier — if you
 * "simplify" those selectors, this test is what catches you.
 *
 * FLOOR 2 — 44px minimum on the controls a field tech actually presses. Apple's
 * HIG default control size and WCAG 2.2 SC 2.5.5 are the same 44 number on iOS,
 * where 1pt maps to 1 CSS px. 149 of 221 targets failed.
 *
 * Deliberately NOT asserted here: every interactive element. Incidental targets
 * nested inside a much larger pressable row (the documented `.rowopen` pattern)
 * are fine — an adversarial check confirmed a real tap on the row opens the
 * record. Asserting on all of them would encode a false failure.
 */

import { test, expect } from "@playwright/test";
import { login, prepare, settle, OWNER } from "./helpers/ui";

const PHONE = { width: 402, height: 874 };

/** Routes with real form and list density. */
const ROUTES = ["/dashboard", "/customers", "/pipeline", "/jobs", "/money", "/tasks", "/settings", "/more"];

/** Controls that must clear 44px: the ones a tech presses on purpose. */
const PRIMARY_TARGETS = [".btn", ".chip", ".iconbtn", "#mobiletabs a", ".uirow-clickable", ".morerow"];

const TEXT_ENTRY =
  'input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]):not([type=hidden]):not([type=submit]):not([type=button]),textarea,select';

test.describe.configure({ mode: "serial" });

test.describe("mobile ergonomic floors", () => {
  test("no text-entry control computes under 16px (iOS auto-zoom floor)", async ({ page }) => {
    await prepare(page, "light");
    await page.setViewportSize(PHONE);
    await login(page, OWNER);

    const offenders: Array<{ route: string; sel: string; fontSize: number }> = [];
    for (const route of ROUTES) {
      await page.goto(route);
      await settle(page);
      offenders.push(
        ...(await page.evaluate((sel) => {
          const out: Array<{ route: string; sel: string; fontSize: number }> = [];
          for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
            if (el.offsetParent === null) continue; // not rendered
            const fs = parseFloat(getComputedStyle(el).fontSize);
            if (fs < 16) {
              out.push({
                route: location.pathname,
                sel: `${el.tagName.toLowerCase()}[type=${el.getAttribute("type") ?? "-"}].${(el.className || "").toString().split(" ")[0]}`,
                fontSize: fs,
              });
            }
          }
          return out;
        }, TEXT_ENTRY)),
      );
    }

    expect(
      offenders,
      `Controls under 16px force an iOS zoom on focus:\n${offenders.map((o) => `  ${o.route} ${o.sel} = ${o.fontSize}px`).join("\n")}`,
    ).toEqual([]);
  });

  test("primary controls are at least 44px on both axes", async ({ page }) => {
    await prepare(page, "light");
    await page.setViewportSize(PHONE);
    await login(page, OWNER);

    const offenders: Array<{ route: string; sel: string; w: number; h: number }> = [];
    for (const route of ROUTES) {
      await page.goto(route);
      await settle(page);
      offenders.push(
        ...(await page.evaluate((selectors) => {
          const out: Array<{ route: string; sel: string; w: number; h: number }> = [];
          for (const sel of selectors) {
            for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
              if (el.offsetParent === null) continue;
              const r = el.getBoundingClientRect();
              if (r.width === 0 || r.height === 0) continue;
              if (r.width < 44 || r.height < 44) {
                out.push({
                  route: location.pathname,
                  sel: `${sel} → .${(el.className || "").toString().split(" ").slice(0, 2).join(".")} "${(el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 18)}"`,
                  w: Math.round(r.width * 10) / 10,
                  h: Math.round(r.height * 10) / 10,
                });
              }
            }
          }
          return out;
        }, PRIMARY_TARGETS)),
      );
    }

    expect(
      offenders,
      `Primary controls under 44px are hard to hit with a gloved thumb:\n${offenders.map((o) => `  ${o.route} ${o.sel} = ${o.w}x${o.h}`).join("\n")}`,
    ).toEqual([]);
  });
});
