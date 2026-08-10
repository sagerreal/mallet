import { test, expect, type Page } from "@playwright/test";
import { login, OWNER } from "./helpers/ui";

test("golden path: customer → quote → accept → job → complete → invoice → paid", async ({ page }) => {
  const name = `Golden ${Date.now()}`;
  await login(page, OWNER);

  // Customer
  await page.goto("/customers");
  await page.getByRole("button", { name: "New customer" }).first().click();
  await page.getByLabel("Name").fill(name);
  await page.getByRole("button", { name: "Add customer" }).click();
  await page.getByText(name).first().click();

  // Quote
  await page.getByRole("button", { name: "New quote" }).click();
  await page.getByPlaceholder("Description").fill("Panel replacement");
  await page.getByLabel("Rate ($)").fill("450");
  await page.getByRole("button", { name: "Create draft" }).click();
  await page.getByRole("button", { name: "Send to customer" }).click();
  await page.getByRole("button", { name: "Mark accepted" }).click();

  // Job
  await page.getByRole("button", { name: "Create job" }).click();
  await page.getByRole("button", { name: "Start" }).click();
  await page.getByRole("button", { name: "Complete" }).click();

  // Invoice + payment
  await page.getByRole("button", { name: "Create invoice" }).click();
  await page.getByRole("button", { name: "Send invoice" }).click();
  await page.getByRole("button", { name: "Record payment" }).first().click();
  await page.getByRole("button", { name: "Record payment" }).last().click(); // submit with prefilled full balance
  await expect(page.getByText("paid").first()).toBeVisible();
});

// ---------------------------------------------------------------------------
// THE WORK BOARD on Office Today (/dashboard).
//
// The seeded E2E org is what makes these assertions real rather than tautological: it carries
// intake leads, jobs both scheduled and unscheduled, finished-unbilled work and overdue bills, so
// every column below has something in it and two of them carry BOTH a needs-action group and a
// passive one. If a future change to scripts/seed-e2e.mjs empties one of those, the guards here
// fail loudly rather than passing over an empty board.
// ---------------------------------------------------------------------------

/** The four columns, in the order work moves through the shop (features/board/use-work-board). */
const COLUMN_TITLES = ["New requests", "Estimates & quotes", "Jobs", "Billing"] as const;

/** The one amber group header, in every column (features/board/work-board ACTION_LABEL). */
const ACTION_LABEL = "Needs action";
/** Somebody else's turn, named per column (work-board PASSIVE_LABEL) — plus the in-field group. */
const PASSIVE_LABELS = [
  "Waiting for customer",
  "Scheduled / waiting",
  "Awaiting payment",
  "Scheduled / in field",
];

/**
 * Why Send is off for this org, verbatim (features/a2p/use-sms-ready SMS_NOT_READY_REASON).
 *
 * Copied rather than imported: the e2e layer imports no application code, so a copy change has to
 * be made deliberately in both places. This IS the honest production state — the E2E org has no
 * active 10DLC campaign, so a Send here would be refused by the carrier. Nothing is mocked.
 */
const SMS_NOT_READY_REASON = "Texting isn't set up yet — finish A2P registration in Settings";

/** The board's four columns, each a `<section>` labelled "<title> column" (implicit role=region). */
const boardColumns = (page: Page) => page.getByRole("region", { name: /\bcolumn$/ });

/** Wait out the skeleton: the labelled regions only exist once the composed read has settled. */
async function waitForBoard(page: Page): Promise<void> {
  await expect(page.locator('[role="status"][aria-busy="true"]')).toHaveCount(0, { timeout: 30_000 });
  await expect(boardColumns(page)).toHaveCount(4, { timeout: 30_000 });
}

/**
 * The GROUP headers of each column, in DOM order.
 *
 * `:scope > .kgrp` and not `.kgrp`: the same class captions an on-card draft ("Text · ready to
 * send") and a ghost's EXAMPLE tag, and both live inside a `.kcard`. Only a group header is a
 * direct child of the column. The trailing count span is stripped so the label can be compared.
 */
async function columnGroups(page: Page): Promise<{ column: string; groups: string[] }[]> {
  return page.locator("section.col").evaluateAll((sections) =>
    sections.map((section) => ({
      column: section.getAttribute("aria-label") ?? "",
      groups: Array.from(section.querySelectorAll(":scope > .kgrp")).map((group) =>
        (group.textContent ?? "").replace(/\d+\s*$/, "").trim(),
      ),
    })),
  );
}

test.describe("the work board on Office Today", () => {
  test.describe.configure({ mode: "serial" });

  test("four labelled columns, in the order work moves through the shop", async ({ page }) => {
    await login(page, OWNER);
    await page.goto("/dashboard");
    await waitForBoard(page);

    const labels = await boardColumns(page).evaluateAll((els) =>
      els.map((el) => el.getAttribute("aria-label")),
    );
    expect(labels).toEqual(COLUMN_TITLES.map((title) => `${title} column`));
  });

  test("inside a column, the shop's own move is pinned above somebody else's turn", async ({ page }) => {
    await login(page, OWNER);
    await page.goto("/dashboard");
    await waitForBoard(page);

    const columns = await columnGroups(page);
    const mixed = columns.filter(
      (c) =>
        c.groups.includes(ACTION_LABEL) && c.groups.some((g) => PASSIVE_LABELS.includes(g)),
    );

    // Not a soft check: without a column holding both shapes the ordering assertion below is
    // vacuous, so the fixture itself is asserted. The seed carries unscheduled jobs beside
    // scheduled ones and finished-unbilled work beside a bill that isn't due yet.
    expect(
      mixed.length,
      `no column held both a needs-action and a passive group — groups were ${JSON.stringify(columns)}`,
    ).toBeGreaterThan(0);

    for (const column of mixed) {
      const action = column.groups.indexOf(ACTION_LABEL);
      const passive = column.groups.findIndex((g) => PASSIVE_LABELS.includes(g));
      expect(action, `${column.column}: ${column.groups.join(" | ")}`).toBeLessThan(passive);
    }
  });

  test("a card name opens the record that card IS", async ({ page }) => {
    await login(page, OWNER);
    await page.goto("/dashboard");
    await waitForBoard(page);

    // The requests column holds intake leads, so the modal behind a card here is the CUSTOMER —
    // and the lead modal labels its dialog with the customer's own name, which is what makes
    // "the matching modal" assertable rather than just "a modal opened".
    const card = boardColumns(page).first().locator(".kcard").first();
    const name = (await card.locator("button.cname").first().innerText()).trim();
    expect(name).not.toEqual("");

    await card.locator("button.cname").first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("aria-label", name, { timeout: 20_000 });
  });

  test("the hero states nothing about the day until the board has landed", async ({ page }) => {
    // Installed BEFORE the login navigation, because login itself lands on /dashboard — that first
    // cold load is precisely the paint a hydration flash would happen in.
    await page.addInitScript(() => {
      const flashes: string[] = [];
      (window as Window & { __heroFlash?: string[] }).__heroFlash = flashes;
      const check = () => {
        // The board's own skeleton. While it is up, `loading` is true on the hero too (the
        // dashboard derives both from the same board.isFetched), so the hero must be a skeleton.
        if (!document.querySelector('[role="status"][aria-busy="true"]')) return;
        const figure = (document.querySelector(".herofig")?.textContent ?? "").trim();
        const thesis = document.querySelector(".ticket .thesis");
        // The loading thesis is aria-hidden and holds only a shimmer bar; a real sentence there
        // means a claim about the day was painted from figures the app did not have yet.
        const sentence =
          thesis && thesis.getAttribute("aria-hidden") !== "true"
            ? (thesis.textContent ?? "").trim()
            : "";
        if (figure !== "") flashes.push(`herofig: ${figure}`);
        if (sentence !== "") flashes.push(`thesis: ${sentence}`);
      };
      new MutationObserver(check).observe(document.documentElement, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    });

    await login(page, OWNER);
    await page.goto("/dashboard");
    await waitForBoard(page);

    const flashes = await page.evaluate(
      () => (window as Window & { __heroFlash?: string[] }).__heroFlash ?? [],
    );
    expect(flashes, "the hero made a claim while the board was still loading").toEqual([]);

    // …and once it HAS landed the hero says something. A permanently skeletal hero would satisfy
    // the invariant above and tell the owner nothing.
    const thesis = page.locator(".ticket .thesis");
    await expect(thesis).toBeVisible();
    await expect(thesis).not.toHaveAttribute("aria-hidden", "true");
    expect((await thesis.innerText()).trim()).not.toEqual("");

    // The seeded org has overdue bills and unscheduled work waiting, so the figure is drawn — and
    // when it is, it is money, not a placeholder.
    await expect(page.locator(".herofig")).toHaveText(/^\$[\d,]+$/);
  });

  test("Send is disabled with its reason — this org's 10DLC campaign is not active", async ({ page }) => {
    await login(page, OWNER);
    await page.goto("/dashboard");
    await waitForBoard(page);

    const sends = page.getByRole("button", { name: "Send", exact: true });
    // Prepared reminders ride the overdue bills in the seed; no draft on the board means the
    // gate below is asserting nothing.
    expect(await sends.count(), "no on-card draft on the board to gate").toBeGreaterThan(0);

    const send = sends.first();
    await expect(send).toBeDisabled();
    await expect(send).toHaveAttribute("title", SMS_NOT_READY_REASON, { timeout: 20_000 });

    // The words stay on screen regardless — a blocked button must not take the draft away with it.
    await expect(page.locator(".cardghost").first()).not.toBeEmpty();
  });
});
