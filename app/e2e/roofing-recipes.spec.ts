/**
 * e2e/roofing-recipes.spec.ts
 *
 * The roofing recipes end-to-end, on the Maps STUB harness (see
 * e2e/tracer-roof-edges.spec.ts for the dummy-key dance):
 *
 *   NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=e2e-stub PORT=3211 pnpm dev
 *   E2E_MAPS_STUB=1 E2E_BASE_URL=http://localhost:3211 pnpm exec playwright test e2e/roofing-recipes.spec.ts
 *
 * Covered: trace → Pitched → classify edges (rakes + a ridge + a hip) → save
 * held → "Seed lines" opens the assembly picker → "Asphalt shingle reroof"
 * seeds the component lines client-side with the derived-waste notice
 * ("Waste 12% (hips on this roof) — change it in the Pricebook."), and the
 * pricebook's Assemblies card reveals the roofing dials in trade vocabulary.
 *
 * Screenshots land in SHOT_DIR (default test-results/).
 */

import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { OWNER, login } from "./helpers/ui";
import { mapsStubInit } from "./helpers/maps-stub";

const enabled = process.env.E2E_MAPS_STUB === "1";
const shotDir = process.env.SHOT_DIR ?? "test-results";

const shot = async (page: Page, name: string): Promise<void> => {
  mkdirSync(shotDir, { recursive: true });
  await page.screenshot({ path: join(shotDir, name), fullPage: false });
};

/** Click the stub map at an offset from the map element's center. */
async function clickMap(page: Page, dx: number, dy: number): Promise<void> {
  const box = await page.locator('[data-stub="map"]').boundingBox();
  if (!box) throw new Error("stub map not laid out");
  await page.mouse.click(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy);
}

/** Tap the i-th clickable overlay line (perimeter edges, then interior lines). */
async function tapLine(page: Page, index: number): Promise<void> {
  await page.evaluate((i) => {
    const hits = document.querySelectorAll('[data-stub-hit="polyline"]');
    const el = hits[i];
    if (!el) throw new Error(`no stub hit line at index ${i} (found ${hits.length})`);
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }, index);
}

test.describe("roofing recipes (Maps stub)", () => {
  test.skip(!enabled, "set E2E_MAPS_STUB=1 (dev server needs a dummy NEXT_PUBLIC_GOOGLE_MAPS_API_KEY)");

  test("a classified pitched trace seeds 'Asphalt shingle reroof' component lines with the waste notice", async ({
    page,
  }) => {
    await page.addInitScript(mapsStubInit);
    await login(page, OWNER);

    await page.goto("/composer");
    const openTracer = page.getByRole("button", { name: "Measure from satellite" });
    await expect(openTracer, "Measure section missing — measurementEstimating toggle must be ON for the E2E org").toBeVisible({
      timeout: 15_000,
    });
    await openTracer.click();

    await expect(page.locator('[data-stub="map"]')).toBeVisible();
    await page.evaluate(() => {
      (window as unknown as { __mapsStub: { setView: (a: number, b: number, c: number) => boolean } }).__mapsStub.setView(
        35.7712,
        -78.6382,
        20,
      );
    });

    const dialog = page.getByRole("dialog");

    // Trace a rectangle: TL → TR → BR → BL (edge 0 = top, 1 = right, 2 =
    // bottom, 3 = left), then close with Done.
    await clickMap(page, -120, -80);
    await clickMap(page, 120, -80);
    await clickMap(page, 120, 80);
    await clickMap(page, -120, 80);
    await dialog.getByRole("button", { name: "Done", exact: true }).click();

    // Pitched engages the edges step; classify a gable with one hip so the
    // derived waste lands on the moderate tier ("hips on this roof", 12%).
    await dialog.getByRole("button", { name: "Pitched" }).click();
    const bar = page.getByRole("group", { name: "Roof edges" });
    await expect(bar).toBeVisible();
    await tapLine(page, 1); // right → rake
    await tapLine(page, 3); // left → rake
    await expect(bar).toContainText(/Rakes ?\d+ ft/);

    // A ridge across the middle…
    await dialog.getByRole("button", { name: "Add a line" }).click();
    await clickMap(page, -110, 0);
    await clickMap(page, 110, 0);
    await expect(bar).toContainText(/Ridge ?\d+ ft/);
    // …and a short hip line (default class ridge → one tap → hip). Endpoints
    // sit well inside the outline: a click near an existing overlay line lands
    // on its hit region and cycles it instead of dropping a vertex.
    await dialog.getByRole("button", { name: "Add a line" }).click();
    await clickMap(page, -80, -20);
    await clickMap(page, -30, -55);
    await tapLine(page, 5);
    await expect(bar).toContainText(/Hips ?\d+ ft/);

    await dialog.getByLabel("Surface name").fill("Main roof");
    await dialog.getByRole("button", { name: "Save surface" }).click();
    await expect(page.getByText("Main roof")).toBeVisible();
    await expect(page.getByText(/Hips \d+ ft/)).toBeVisible();

    // Seed lines → the in-flow assembly picker offers the roofing recipe.
    await page.getByRole("button", { name: "Seed lines" }).click();
    const picker = page.getByRole("group", { name: "Price this surface with" });
    await expect(picker).toBeVisible();
    await expect(picker.getByRole("button", { name: "Asphalt shingle reroof" })).toBeVisible();
    await picker.getByRole("button", { name: "Asphalt shingle reroof" }).click();

    // The component breakdown lands on the quote, priced client-side (the
    // descriptions live in editable line inputs — assert on the rows); the
    // derived waste is reported honestly, with where to change it.
    await expect(page.getByRole("row", { name: /Field shingles \(\d+ bundles\)/ })).toBeVisible();
    await expect(page.getByRole("row", { name: /Hip and ridge cap \(\d+ bundles?\)/ })).toBeVisible();
    await expect(page.getByRole("row", { name: /Install labor/ })).toBeVisible();
    await expect(page.getByText(/Waste 12% \(hips on this roof\) — change it in the Pricebook\./)).toBeVisible();
    await expect(page.getByRole("button", { name: "Seeded" })).toBeVisible();

    await shot(page, "roof-seed-lines.png");
  });

  test("the pricebook's Assemblies card reveals the roofing dials in trade vocabulary", async ({
    page,
  }) => {
    await page.addInitScript(mapsStubInit);
    await login(page, OWNER);

    await page.goto("/dashboard?tab=pricebook");
    const assembliesSeg = page.getByRole("button", { name: /^Assemblies/ });
    await expect(assembliesSeg, "Assemblies segment missing — measurementEstimating toggle must be ON for the E2E org").toBeVisible({
      timeout: 15_000,
    });
    await assembliesSeg.click();

    // Level 0: the roofing recipes list with how they price.
    await expect(page.getByText("Asphalt shingle reroof")).toBeVisible();
    await expect(page.getByText("Roof tune-up / repair allowance")).toBeVisible();

    // The reveal: org-tunable constants as plain-vocabulary dials.
    await page.getByText("Asphalt shingle reroof").click();
    await expect(page.getByLabel("Shingle bundles")).toBeVisible();
    await expect(page.getByLabel("Install labor")).toBeVisible();
    await expect(page.getByLabel("Waste on a cut-up roof")).toBeVisible();
    const iceDam = page.getByLabel("Ice-dam region");
    await expect(iceDam).toBeVisible();
    await expect(iceDam).toHaveAttribute("type", "checkbox");
    await expect(page.getByLabel("Pipe boots")).toBeVisible();

    await shot(page, "roof-pricebook-dials.png");
  });
});
