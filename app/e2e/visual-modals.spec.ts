/**
 * e2e/visual-modals.spec.ts
 * Visual-regression baselines for MODALS — the surfaces the page-level
 * visual.spec.ts can't reach, because modals open on interaction and carry the
 * heaviest inline-style debt (tech-job 36, job 27, invoice 26, import 20…).
 *
 * Modals are store-driven (openModal(id, params)), not URL-driven, so rather than
 * chase fragile click paths we drive the store directly through a dev/test-only
 * window handle (lib/store/app-store.ts, non-production only) and read real seeded
 * record ids out of the hydrated store. Deterministic, no data assumptions beyond
 * "the E2E org has at least one lead / job / estimate / invoice".
 *
 * Opt-in via E2E_VISUAL=1 (same as visual.spec.ts) — pixel diffing is
 * machine-specific.
 */

import { test, expect, type Page } from "@playwright/test";
import { login, prepare, settle, dynamicRegionsIn, OWNER } from "./helpers/ui";

test.skip(!process.env.E2E_VISUAL, "set E2E_VISUAL=1 to run modal visual regression");

type Ids = { leadId?: string; jobId?: string; estId?: string; invoiceId?: string };

/** Read seeded ids from the hydrated store via the dev-only window handle. */
async function seedIds(page: Page): Promise<Ids> {
  return page.evaluate(() => {
    const store = (window as unknown as { __appStore?: { getState: () => Record<string, unknown> } }).__appStore;
    const s = store?.getState() as
      | { leads?: { id: string }[]; jobs?: { id: string }[]; estimates?: { id: string }[]; invoices?: { id: string }[] }
      | undefined;
    return {
      leadId: s?.leads?.[0]?.id,
      jobId: s?.jobs?.[0]?.id,
      estId: s?.estimates?.[0]?.id,
      invoiceId: s?.invoices?.[0]?.id,
    };
  });
}

async function openModal(page: Page, id: string, params?: Record<string, string>): Promise<void> {
  await page.evaluate(
    ([mid, mparams]) => {
      const store = (window as unknown as { __appStore?: { getState: () => { openModal: (i: string, p?: unknown) => void } } }).__appStore;
      store?.getState().openModal(mid as string, mparams);
    },
    [id, params] as const,
  );
}

async function closeModal(page: Page): Promise<void> {
  await page.evaluate(() => {
    const store = (window as unknown as { __appStore?: { getState: () => { closeModal: () => void } } }).__appStore;
    store?.getState().closeModal();
  });
  await page.getByRole("dialog").waitFor({ state: "hidden" }).catch(() => {});
}

/** Open a modal, wait for it, screenshot the dialog panel, close. */
async function shootModal(page: Page, name: string, id: string, params?: Record<string, string>): Promise<void> {
  await openModal(page, id, params);
  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ state: "visible", timeout: 8000 });
  await settle(page);
  await expect(dialog).toHaveScreenshot(`modal-${name}.png`, {
    animations: "disabled",
    // Scoped to the dialog, NOT the page: a page-wide mask locator paints
    // [data-dynamic] nodes from the surface behind the modal into this clipped
    // shot, which both hid real modal content and made the baseline drift with
    // unrelated dashboard data. See dynamicRegionsIn.
    mask: dynamicRegionsIn(dialog),
    maxDiffPixels: 150,
    timeout: 15_000,
  });
  await closeModal(page);
}

test.describe("modal visual baselines", () => {
  test.describe.configure({ mode: "serial" });

  test("office modals", async ({ page }) => {
    await prepare(page, "light");
    await page.setViewportSize({ width: 1280, height: 900 });
    await login(page, OWNER);
    await page.goto("/dashboard");
    await settle(page);
    const ids = await seedIds(page);

    // No-param modals — always openable.
    await shootModal(page, "new-customer", "new-customer");
    await shootModal(page, "new-job", "new-job");
    await shootModal(page, "import-customers", "import-customers");
    await shootModal(page, "import-services", "import-services");

    // Record-driven modals — skip cleanly if the E2E org lacks that record.
    if (ids.leadId) await shootModal(page, "lead", "lead", { leadId: ids.leadId });
    if (ids.jobId) await shootModal(page, "job", "job", { jobId: ids.jobId });
    if (ids.jobId) await shootModal(page, "tech-job", "tech-job", { jobId: ids.jobId });
    if (ids.estId) await shootModal(page, "estimate", "est", { estId: ids.estId });
    if (ids.invoiceId) await shootModal(page, "invoice", "invoice", { invoiceId: ids.invoiceId });

    // The /money/[id] and /jobs/[id] FULL-PAGE shots that used to live here are gone.
    // They existed to prove the P4f port off Tailwind was pixel-identical; Tailwind is
    // fully removed (no config, no dependency), so that job is done. They could not
    // keep passing regardless, for two structural reasons:
    //   1. This spec needs the dev-only `window.__appStore` handle, so it cannot run
    //      against a production build — and `next dev` paints the dev-tools badge into
    //      any full-page shot. That is the #246 trap; a dialog-clipped shot avoids it,
    //      a full-page one cannot.
    //   2. They shot `invoices[0]` / `jobs[0]` from live data, so the baseline captured
    //      whichever record happened to be first (it drifted INV-1005/$450 → INV-1006/
    //      $900). No amount of masking fixes a baseline whose subject changes.
    // The modal shots above are dialog-clipped and record-agnostic, so they are stable.
  });
});
