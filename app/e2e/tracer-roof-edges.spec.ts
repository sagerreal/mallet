/**
 * e2e/tracer-roof-edges.spec.ts
 *
 * The tracer's roof-edge classification, driven end-to-end against the REAL
 * app with the Maps STUB (e2e/helpers/maps-stub.ts) — no Google key, no
 * network imagery, deterministic geometry. Opt-in via E2E_MAPS_STUB=1 because
 * the dev server must be started with a non-empty
 * NEXT_PUBLIC_GOOGLE_MAPS_API_KEY (any value — the stub intercepts before the
 * loader runs):
 *
 *   NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=e2e-stub PORT=3201 pnpm dev
 *   E2E_MAPS_STUB=1 E2E_BASE_URL=http://localhost:3201 pnpm exec playwright test e2e/tracer-roof-edges.spec.ts
 *
 * Covered: trace → close → Pitched → the EDGES step (legend + readout, edge
 * tap-cycling, an interior line with class cycling) → save → the held row's
 * classed summary. The saved-capture leg (a persisted classified capture's
 * Measure row + view) additionally needs E2E_TRACER_JOB_ID pointing at a job
 * that already has a classified capture (scripts or a prior run seed it).
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

/**
 * Tap the i-th clickable overlay line (perimeter edges in vertex order, then
 * interior lines). Dispatched on the hit element directly — the modal scrolls
 * internally, so a coordinate click can land on the sticky sheet head when an
 * edge sits near the clipped map top.
 */
async function tapLine(page: Page, index: number): Promise<void> {
  await page.evaluate((i) => {
    const hits = document.querySelectorAll('[data-stub-hit="polyline"]');
    const el = hits[i];
    if (!el) throw new Error(`no stub hit line at index ${i} (found ${hits.length})`);
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }, index);
}

test.describe("tracer roof edges (Maps stub)", () => {
  test.skip(!enabled, "set E2E_MAPS_STUB=1 (dev server needs a dummy NEXT_PUBLIC_GOOGLE_MAPS_API_KEY)");

  test("pitched trace gets the edges step: cycle classes, draw an interior line, save classed", async ({
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

    // The stub map mounts; move from the continental default to rooftop scale.
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

    // Pitched engages the edges step: legend bar + every edge an EAVE.
    // The legend always names all five classes; a class only gains a FIGURE
    // ("Rakes 127 ft") once an edge carries it — assertions match label+digits.
    await dialog.getByRole("button", { name: "Pitched" }).click();
    const bar = page.getByRole("group", { name: "Roof edges" });
    await expect(bar).toBeVisible();
    await expect(bar).toContainText(/Eaves ?\d+ ft/);

    // Tap-cycle: top edge → ridge (2 taps), right + left → rake (1 tap each).
    const edgeHit = page.locator('[data-stub-hit="polyline"]');
    await expect(edgeHit).toHaveCount(4);
    await tapLine(page, 0);
    await expect(bar).toContainText(/Rakes ?\d+ ft/);
    await tapLine(page, 0);
    await expect(bar).toContainText(/Ridge ?\d+ ft/);
    await tapLine(page, 1);
    await tapLine(page, 3);
    await expect(bar).toContainText(/Rakes ?\d+ ft/);

    // An interior line: two taps across the middle, then cycle it to VALLEY.
    await dialog.getByRole("button", { name: "Add a line" }).click();
    await clickMap(page, -110, 0);
    await clickMap(page, 110, 0);
    await expect(edgeHit).toHaveCount(5); // 4 perimeter edges + the line
    await tapLine(page, 4); // ridge → hip
    await expect(bar).toContainText(/Hips ?\d+ ft/);
    await tapLine(page, 4); // hip → valley
    await expect(bar).toContainText(/Valleys ?\d+ ft/);
    await expect(bar).not.toContainText(/Hips ?\d+ ft/);

    // Whole outline + both bars in frame for the screenshot: align the map's
    // top with the scrollport, then back off by the STICKY sheet head's height
    // (scrollIntoView doesn't account for sticky overlays).
    await page.locator(".tracer-map").evaluate((el) => {
      el.scrollIntoView({ block: "start", behavior: "instant" });
      const panel = el.closest(".modal");
      const head = panel?.querySelector(".sheet-head");
      if (panel && head) panel.scrollTop -= head.getBoundingClientRect().height;
    });
    await shot(page, "edges-step.png");

    // Save as a held trace; the Measure row reads out the classed linears.
    await dialog.getByLabel("Surface name").fill("Main roof");
    await dialog.getByRole("button", { name: "Save surface" }).click();
    await expect(page.getByText("Main roof")).toBeVisible();
    await expect(page.getByText(/Eaves \d+ ft/)).toBeVisible();
    await expect(page.getByText(/Ridge \d+ ft/)).toBeVisible();
    await expect(page.getByText(/Valleys \d+ ft/)).toBeVisible();
    await shot(page, "held-row-classed.png");
  });

  test("a saved classified capture shows classed linears in the Measure row and its view", async ({
    page,
  }) => {
    const jobId = process.env.E2E_TRACER_JOB_ID;
    test.skip(!jobId, "set E2E_TRACER_JOB_ID to a job holding a classified capture");

    await page.addInitScript(mapsStubInit);
    await login(page, OWNER);
    await page.goto(`/composer?job=${jobId}`);

    // The Measure section lists the job's captures; the classified pitched
    // capture reads out classed linears instead of a bare perimeter.
    await expect(page.getByText(/Eaves \d+ ft/).first()).toBeVisible({ timeout: 20_000 });
    await shot(page, "measure-row-saved.png");

    // Open the saved capture: the outline re-draws with its class colors and
    // the summary carries the classed readout. (toBeAttached, not toBeVisible:
    // an axis-aligned SVG line has a zero-height bounding box, which
    // Playwright's visibility check reads as hidden.)
    await page.getByRole("button", { name: /^Open / }).first().click();
    await expect(page.locator('[data-stub="map"]')).toBeVisible();
    await expect(page.locator('[data-stub="polyline"]').first()).toBeAttached();
    await expect(page.getByRole("dialog").getByText(/Eaves \d+ ft/).first()).toBeVisible();
    await shot(page, "saved-capture-classed.png");
  });
});
