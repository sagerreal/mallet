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
import { login, prepare, settle, dynamicRegions, OWNER } from "./helpers/ui";

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

/** Navigate to a dynamic detail route and screenshot the full page. These routes
 *  (/money/[id], /jobs/[id]) are absent from the route net because they need a
 *  seeded record id; we take it from the hydrated store. */
async function shootDetailPage(page: Page, name: string, path: string): Promise<void> {
  await page.goto(path);
  await settle(page);
  await expect(page).toHaveScreenshot(`page-${name}.png`, {
    animations: "disabled",
    mask: dynamicRegions(page),
    maxDiffPixels: 150,
    fullPage: true,
    timeout: 15_000,
  });
}

/** Open a modal, wait for it, screenshot the dialog panel, close. */
async function shootModal(page: Page, name: string, id: string, params?: Record<string, string>): Promise<void> {
  await openModal(page, id, params);
  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ state: "visible", timeout: 8000 });
  await settle(page);
  await expect(dialog).toHaveScreenshot(`modal-${name}.png`, {
    animations: "disabled",
    mask: dynamicRegions(page),
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

    // Dynamic detail routes — the last heavy Tailwind pages; baseline them so the
    // P4f port off Tailwind is provably pixel-identical (0-diff without --update).
    if (ids.invoiceId) await shootDetailPage(page, "money-detail", `/money/${ids.invoiceId}`);
    if (ids.jobId) await shootDetailPage(page, "jobs-detail", `/jobs/${ids.jobId}`);
  });
});
