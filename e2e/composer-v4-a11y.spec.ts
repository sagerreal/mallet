/**
 * e2e/composer-v4-a11y.spec.ts
 * Accessibility scan of the composer's INTERACTIVE states.
 *
 * a11y.spec.ts scans every route as it first paints. That is the right net for a route
 * inventory and the wrong one for this surface: the composer's default paint is an empty
 * quote, so the assembly rows, the sections, the costing columns, the document toolbar, the
 * proposal sheets and the job-costs picker — everything the v4 port added — sit behind an
 * interaction it never performs. Five PRs of UI shipped without any automated scan reaching
 * them.
 *
 * So this walks the composer into each state and scans it there. Same axe config and the same
 * zero-violation bar as the route net; a route already covered there is not re-scanned.
 */

import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { login, prepare, settle, OWNER } from "./helpers/ui";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** AxeBuilder needs a page from a real context — it throws on browser.newPage(). */
async function scan(page: import("@playwright/test").Page, label: string) {
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const summary = violations
    .map((v) => `${v.id} ×${v.nodes.length} [${v.nodes.map((n) => n.target.join(" ")).join(" | ")}]`)
    .join(", ");
  expect(violations.length, `${label}: ${summary}`).toBe(0);
}

test.describe.configure({ mode: "serial" });

test.describe("composer v4 — the states the route scan cannot reach", () => {
  test.beforeEach(async ({ page }) => {
    await prepare(page, "light");
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page, OWNER);
  });

  test("the estimate: an assembly, a section, and the costing columns", async ({ page }) => {
    await page.goto("/composer");
    await settle(page);

    // The composer starts with ZERO rows now (the mock's empty state) — ask for the first one.
    await page.getByRole("button", { name: "+ Add line item" }).click();
    await page.getByLabel("Description, line 1").fill("Cedar privacy fence");
    await page.getByLabel("Quantity, line 1").fill("100");
    await page.getByTitle("Price this line from the parts and labour under it").first().click();
    await page.getByLabel("Description, component 2").fill("Line posts");
    await page.getByLabel("Quantity or math, component 2").fill("qty/8+1");
    await page.getByLabel("Price, line 2").fill("24.30");

    // The secondary tools live behind the footer's More menu now — scan it open, then use it.
    await page.getByRole("button", { name: "More \u25be" }).click();
    await scan(page, "composer \u00b7 footer More menu, open");
    await page.getByText("+ Section").click();
    await page.getByLabel("Section name, section 1").fill("Exterior");
    await page.getByText("+ Add line to Exterior").click();
    await page.getByLabel("Description, line 3").fill("Haul-away");
    await page.getByLabel("Price, line 3").fill("240");

    // The costing view — markup column, rolled-up cells, and the job-costs card.
    // The costing view is the header segmented control now, not a footer toggle.
    await page.getByRole("button", { name: "Costing" }).click();
    // Unit is a COSTING column now — on the pricing view it lives in the rail's quantity
    // editor, so the ledger only offers this cell here.
    await page.getByLabel("Unit, line 1").fill("LF");
    await settle(page);
    await scan(page, "composer · estimate, costing view");
  });

  test("the inspector rail — docked, editing, and folded to its seam", async ({ page }) => {
    await page.goto("/composer");
    await settle(page);
    await page.getByRole("button", { name: "+ Add line item" }).click();
    await page.getByLabel("Description, line 1").fill("Cedar privacy fence, 6 ft");
    await page.getByLabel("Quantity, line 1").fill("100");
    await page.getByTitle("Price this line from the parts and labour under it").first().click();
    await page.getByLabel("Description, component 2").fill("Line posts");
    await page.getByLabel("Quantity or math, component 2").fill("qty/8+1");
    await page.getByLabel("Price, line 2").fill("24.30");

    // Select the assembly — the rail docks with the driver editor and the parts accordion,
    // the densest state the rail has.
    await page.getByLabel("Description, line 1").click();
    await page.getByTestId("line-inspector").waitFor();
    await page.getByText("Driver quantity").click();
    await page.getByRole("button", { name: /^Assembly/ }).click();
    await settle(page);
    await scan(page, "composer · inspector rail, assembly with editors open");

    // Folded to the seam: the pull tab and the unfold strip are all that remain.
    await page.getByLabel("Hide details").click();
    await settle(page);
    await scan(page, "composer · inspector rail, folded");
  });

  test("the job-costs picker, open", async ({ page }) => {
    await page.goto("/composer");
    await settle(page);
    await page.getByRole("button", { name: "+ Add line item" }).click();
    await page.getByLabel("Description, line 1").fill("Interior repaint");
    await page.getByLabel("Price, line 1").fill("4495");
    // Job costs live in their own collapsed panel beside Pricing now, not inside the costing view.
    await page.getByText("Other job costs").click();
    await page.getByText("+ Add job cost").click();
    await page.getByLabel("What the cost is, job cost 1").fill("Dumpster");
    await page.getByLabel("Amount, job cost 1").fill("400");
    await page.getByText("Pull from purchase orders").click();
    await settle(page);
    await scan(page, "composer · job costs with the picker open");
  });

  test("the proposal document — Simple, then Full with every section on", async ({ page }) => {
    await page.goto("/composer");
    await settle(page);
    await page.getByRole("button", { name: "+ Add line item" }).click();
    await page.getByLabel("Description, line 1").fill("Interior repaint");
    await page.getByLabel("Price, line 1").fill("4495");
    await page.getByRole("tab", { name: /presentation/i }).click();

    const template = page.getByRole("button", { name: "Interior" });
    if ((await template.count()) === 0) test.skip(true, "no presentation template in this org");
    await template.click();
    await settle(page);
    await scan(page, "composer · proposal, Simple");

    await page.getByRole("button", { name: "Full proposal" }).click();
    await settle(page);
    // Turn on every section, so the scan sees a page of each kind rather than the two the
    // template happens to carry.
    for (const label of ["Letter", "Photos", "Process", "Warranty"]) {
      const chip = page.getByRole("button", { name: label, exact: true });
      if ((await chip.count()) > 0) await chip.first().click();
    }
    await settle(page);
    await scan(page, "composer · proposal, Full with every section");
  });

  /**
   * The CUSTOMER's copy.
   *
   * a11y.spec.ts excludes /q/[token] on purpose — it is token-gated, so a route inventory
   * cannot construct a URL for it. That exclusion is right and it left the one page an actual
   * customer opens with no automated scan at all. This builds a real proposal, sends it, and
   * scans the link.
   */
  test("the customer's copy of a proposal", async ({ page }) => {
    await page.goto("/composer");
    await settle(page);
    // The customer field is inline in the masthead now — "For [Customer]".
    await page.getByPlaceholder("Customer").fill("Cardfix");
    await page.waitForTimeout(700);
    const match = page.locator(".cmp-opt").filter({ hasText: /Cardfix/i }).first();
    if ((await match.count()) === 0) test.skip(true, "no customer to quote in this org");
    await match.click();
    await page.getByRole("button", { name: "+ Add line item" }).click();
    await page.getByLabel("Description, line 1").fill("Interior repaint — 3 bedrooms");
    await page.getByLabel("Price, line 1").fill("4495");

    await page.getByRole("tab", { name: /presentation/i }).click();
    const template = page.getByRole("button", { name: "Interior" });
    if ((await template.count()) === 0) test.skip(true, "no presentation template in this org");
    await template.click();
    await page.getByRole("button", { name: "Full proposal" }).click();
    await settle(page);

    let token: string | null = null;
    page.on("response", async (res) => {
      if (!res.url().includes("quoting") || token) return;
      try {
        const m = /"publicToken":"([a-f0-9]{64})"/.exec(await res.text());
        if (m) token = m[1]!;
      } catch { /* not JSON */ }
    });
    await page.getByRole("tab", { name: /estimate/i }).click();
    await page.getByRole("button", { name: /save draft/i }).click();
    await page.waitForURL(/dashboard/i, { timeout: 30_000 });
    await page.reload();
    await settle(page);
    await page.waitForTimeout(1500);
    expect(token, "no public token off the list response").toBeTruthy();

    // Logged OUT — the customer has a link and nothing else.
    await page.context().clearCookies();
    await page.goto(`/q/${token}`);
    await settle(page);
    await scan(page, "customer copy · proposal, desktop");

    await page.setViewportSize({ width: 390, height: 844 });
    await settle(page);
    await scan(page, "customer copy · proposal, phone");
  });

  test("the document toolbar at a large type size and a dark accent", async ({ page }) => {
    // The design controls change contrast and target sizes — the two things axe measures.
    await page.goto("/composer");
    await settle(page);
    await page.getByRole("tab", { name: /presentation/i }).click();
    const template = page.getByRole("button", { name: "Interior" });
    if ((await template.count()) === 0) test.skip(true, "no presentation template in this org");
    await template.click();
    await settle(page);
    for (let i = 0; i < 6; i += 1) await page.getByLabel("Increase font size").click();
    await page.getByLabel("Plum accent").click();
    await page.getByLabel("Bold headings").click();
    await settle(page);
    await scan(page, "composer · document toolbar, 20px and plum");
  });
});
