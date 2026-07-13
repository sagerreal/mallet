/**
 * lib/store/slices/pricebook-slice.test.ts
 * Unit tests for pricebook-slice persistence layer.
 *
 * Each action is tested for:
 *   (a) Optimistic apply — state reflects change immediately before the network round-trip.
 *   (b) Correct mutation input — the trpcVanilla call receives the right (cents) payload.
 *   (c) Reconcile — the store adopts the server's canonical id/values after resolution.
 *   (d) Rollback — on rejection the state is restored to the pre-mutation snapshot, and the
 *       outcome is surfaced (no silent failures), mirroring addSource / addChecklist.
 *
 * trpcVanilla is module-mocked so no network or Supabase session is needed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createStore, type StoreApi } from "zustand/vanilla";
import { createPricebookSlice, type PricebookSlice } from "./pricebook-slice";
import type { Material } from "../types";

const mutate = {
  createService: vi.fn(),
  updateService: vi.fn(),
  archiveService: vi.fn(),
  createCategory: vi.fn(),
  seed: vi.fn(),
  createMaterial: vi.fn(),
  updateMaterial: vi.fn(),
  archiveMaterial: vi.fn(),
  attachMaterial: vi.fn(),
  detachMaterial: vi.fn(),
  listForService: vi.fn(),
};

vi.mock("@/lib/trpc/vanilla", () => ({
  trpcVanilla: {
    v1: {
      pricebook: {
        service: {
          create: { mutate: (...a: unknown[]) => mutate.createService(...a) },
          update: { mutate: (...a: unknown[]) => mutate.updateService(...a) },
          archive: { mutate: (...a: unknown[]) => mutate.archiveService(...a) },
        },
        category: {
          create: { mutate: (...a: unknown[]) => mutate.createCategory(...a) },
        },
        seed: { mutate: (...a: unknown[]) => mutate.seed(...a) },
        material: {
          create: { mutate: (...a: unknown[]) => mutate.createMaterial(...a) },
          update: { mutate: (...a: unknown[]) => mutate.updateMaterial(...a) },
          archive: { mutate: (...a: unknown[]) => mutate.archiveMaterial(...a) },
        },
        serviceMaterial: {
          attach: { mutate: (...a: unknown[]) => mutate.attachMaterial(...a) },
          detach: { mutate: (...a: unknown[]) => mutate.detachMaterial(...a) },
          listForService: { query: (...a: unknown[]) => mutate.listForService(...a) },
        },
      },
    },
  },
}));

const flush = () => new Promise((r) => setTimeout(r, 0));

function baseServiceDto(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "srv-1",
    categoryId: null,
    code: null,
    name: "Camera inspection",
    description: null,
    unitPriceCents: 28500,
    costCents: 0,
    laborHours: null,
    taxable: false,
    warrantyText: null,
    imageUrl: null,
    isAddon: false,
    active: true,
    position: 0,
    ...overrides,
  };
}

function baseCategoryDto(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "cat-1",
    parentId: null,
    name: "Drains",
    sortOrder: 0,
    ...overrides,
  };
}

function baseMaterialDto(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "mat-1",
    categoryId: null,
    code: null,
    name: "PVC coupling 2in",
    description: null,
    unitCostCents: 350,
    unitOfMeasure: "each",
    markupBps: null,
    taxable: false,
    vendor: null,
    active: true,
    position: 0,
    ...overrides,
  };
}

function baseMaterial(overrides: Partial<Material> = {}): Material {
  return {
    id: "m1",
    categoryId: null,
    code: null,
    name: "PVC coupling 2in",
    description: null,
    unitCost: 3.5,
    unitOfMeasure: "each",
    markupBps: null,
    taxable: false,
    vendor: null,
    active: true,
    position: 0,
    ...overrides,
  };
}

describe("pricebookSlice", () => {
  let store: StoreApi<PricebookSlice>;

  beforeEach(() => {
    vi.clearAllMocks();
    store = createStore<PricebookSlice>((set, get, api) => createPricebookSlice(set, get, api));
  });

  it("starts empty (no SEED_* data)", () => {
    expect(store.getState().services).toEqual([]);
    expect(store.getState().categories).toEqual([]);
  });

  it("setPricebook replaces the whole slice", () => {
    store.getState().setPricebook({
      services: [
        {
          id: "s1",
          categoryId: null,
          code: null,
          name: "Drain snake",
          unitPrice: 150,
          cost: 40,
          laborHours: null,
          taxable: false,
          warrantyText: null,
          imageUrl: null,
          isAddon: false,
          active: true,
          position: 0,
        },
      ],
      categories: [{ id: "c1", parentId: null, name: "Drains", sortOrder: 0 }],
    });
    expect(store.getState().services).toHaveLength(1);
    expect(store.getState().categories).toHaveLength(1);
  });

  // ---- addService -----------------------------------------------------------

  it("addService optimistically appends, calls create with cents, and reconciles the server id", async () => {
    mutate.createService.mockResolvedValue(baseServiceDto({ id: "srv-server" }));

    const result = store.getState().addService({ name: "Camera inspection", unitPrice: 285, cost: 0 });
    expect(store.getState().services.some((s) => s.name === "Camera inspection")).toBe(true);

    await result;

    expect(mutate.createService).toHaveBeenCalledTimes(1);
    const arg = mutate.createService.mock.calls[0]![0] as {
      name: string;
      unitPriceCents: number;
      costCents: number;
    };
    expect(arg.name).toBe("Camera inspection");
    expect(arg.unitPriceCents).toBe(28500); // 285 * 100
    expect(arg.costCents).toBe(0);

    expect(store.getState().services.some((s) => s.id === "srv-server")).toBe(true);
    expect(await result).toEqual({ ok: true });
  });

  it("addService reports {ok:false, reason:'empty'} for a blank name (no persist call)", async () => {
    const r = await store.getState().addService({ name: "   ", unitPrice: 100 });
    expect(r).toEqual({ ok: false, reason: "empty" });
    expect(mutate.createService).not.toHaveBeenCalled();
    expect(store.getState().services).toHaveLength(0);
  });

  it("addService dedupes by name (case-insensitive) before persisting", async () => {
    mutate.createService.mockResolvedValue(baseServiceDto());
    await store.getState().addService({ name: "Camera inspection", unitPrice: 285 });

    const r = await store.getState().addService({ name: "camera inspection", unitPrice: 285 });
    expect(r).toEqual({ ok: false, reason: "duplicate" });
    expect(mutate.createService).toHaveBeenCalledTimes(1);
    expect(store.getState().services).toHaveLength(1);
  });

  it("addService rolls back and reports {ok:false, reason:'failed'} when the persist rejects", async () => {
    mutate.createService.mockRejectedValueOnce(new Error("boom"));
    const r = await store.getState().addService({ name: "Camera inspection", unitPrice: 285 });
    expect(r).toEqual({ ok: false, reason: "failed" });
    expect(store.getState().services.some((s) => s.name === "Camera inspection")).toBe(false);
  });

  // ---- updateService ---------------------------------------------------------

  it("updateService optimistically patches and persists cents, reconciling from the DTO", async () => {
    store.getState().setPricebook({
      services: [
        {
          id: "s1",
          categoryId: null,
          code: null,
          name: "Camera inspection",
          unitPrice: 285,
          cost: 0,
          laborHours: null,
          taxable: false,
          warrantyText: null,
          imageUrl: null,
          isAddon: false,
          active: true,
          position: 0,
        },
      ],
      categories: [],
    });
    mutate.updateService.mockResolvedValue(
      baseServiceDto({ id: "s1", unitPriceCents: 30000, name: "Camera inspection" }),
    );

    store.getState().updateService("s1", { unitPrice: 300 });
    expect(store.getState().services[0]!.unitPrice).toBe(300);

    await flush();

    expect(mutate.updateService).toHaveBeenCalledWith(
      expect.objectContaining({ serviceId: "s1", unitPriceCents: 30000 }),
    );
    expect(store.getState().services[0]!.unitPrice).toBe(300);
  });

  it("updateService rolls back on rejection", async () => {
    store.getState().setPricebook({
      services: [
        {
          id: "s1",
          categoryId: null,
          code: null,
          name: "Camera inspection",
          unitPrice: 285,
          cost: 0,
          laborHours: null,
          taxable: false,
          warrantyText: null,
          imageUrl: null,
          isAddon: false,
          active: true,
          position: 0,
        },
      ],
      categories: [],
    });
    mutate.updateService.mockRejectedValueOnce(new Error("fail"));

    store.getState().updateService("s1", { unitPrice: 300 });
    expect(store.getState().services[0]!.unitPrice).toBe(300);

    await flush();

    expect(store.getState().services[0]!.unitPrice).toBe(285);
  });

  // ---- archiveService ---------------------------------------------------------

  it("archiveService optimistically removes and calls archive; rolls back on failure", async () => {
    store.getState().setPricebook({
      services: [
        {
          id: "s1",
          categoryId: null,
          code: null,
          name: "Camera inspection",
          unitPrice: 285,
          cost: 0,
          laborHours: null,
          taxable: false,
          warrantyText: null,
          imageUrl: null,
          isAddon: false,
          active: true,
          position: 0,
        },
      ],
      categories: [],
    });
    mutate.archiveService.mockRejectedValueOnce(new Error("boom"));

    store.getState().archiveService("s1");
    expect(store.getState().services).toHaveLength(0);

    await flush();

    expect(store.getState().services.some((s) => s.id === "s1")).toBe(true);
  });

  // ---- addCategory ------------------------------------------------------------

  it("addCategory optimistically appends and reconciles the server id", async () => {
    mutate.createCategory.mockResolvedValue(baseCategoryDto({ id: "cat-server" }));

    const result = store.getState().addCategory("Drains");
    expect(store.getState().categories.some((c) => c.name === "Drains")).toBe(true);

    await result;

    expect(mutate.createCategory).toHaveBeenCalledTimes(1);
    expect(store.getState().categories.some((c) => c.id === "cat-server")).toBe(true);
  });

  it("addCategory reports {ok:false, reason:'empty'} for a blank name", async () => {
    const r = await store.getState().addCategory("   ");
    expect(r).toEqual({ ok: false, reason: "empty" });
    expect(mutate.createCategory).not.toHaveBeenCalled();
  });

  it("addCategory dedupes by name (case-insensitive)", async () => {
    mutate.createCategory.mockResolvedValue(baseCategoryDto());
    await store.getState().addCategory("Drains");
    const r = await store.getState().addCategory("drains");
    expect(r).toEqual({ ok: false, reason: "duplicate" });
    expect(mutate.createCategory).toHaveBeenCalledTimes(1);
  });

  it("addCategory rolls back and reports {ok:false, reason:'failed'} on rejection", async () => {
    mutate.createCategory.mockRejectedValueOnce(new Error("boom"));
    const r = await store.getState().addCategory("Drains");
    expect(r).toEqual({ ok: false, reason: "failed" });
    expect(store.getState().categories.some((c) => c.name === "Drains")).toBe(false);
  });

  // ---- seedPricebook (Task 8) --------------------------------------------------

  it("seedPricebook appends the seeded services and categories into an empty store", async () => {
    mutate.seed.mockResolvedValue({
      services: [baseServiceDto({ id: "seed-s1", name: "Toilet reset" })],
      categories: [baseCategoryDto({ id: "seed-c1", name: "Fixtures" })],
    });

    const r = await store.getState().seedPricebook();

    expect(r).toEqual({ ok: true });
    expect(mutate.seed).toHaveBeenCalledTimes(1);
    expect(store.getState().services.some((s) => s.id === "seed-s1")).toBe(true);
    expect(store.getState().categories.some((c) => c.id === "seed-c1")).toBe(true);
  });

  it("seedPricebook never drops services/categories already loaded in the store", async () => {
    store.getState().setPricebook({
      services: [
        {
          id: "already-loaded",
          categoryId: null,
          code: null,
          name: "Existing Service",
          unitPrice: 100,
          cost: 20,
          laborHours: null,
          taxable: false,
          warrantyText: null,
          imageUrl: null,
          isAddon: false,
          active: true,
          position: 0,
        },
      ],
      categories: [{ id: "already-loaded-cat", parentId: null, name: "Existing Category", sortOrder: 0 }],
    });
    mutate.seed.mockResolvedValue({
      services: [baseServiceDto({ id: "seed-s1" })],
      categories: [baseCategoryDto({ id: "seed-c1" })],
    });

    await store.getState().seedPricebook();

    expect(store.getState().services.some((s) => s.id === "already-loaded")).toBe(true);
    expect(store.getState().categories.some((c) => c.id === "already-loaded-cat")).toBe(true);
    expect(store.getState().services).toHaveLength(2);
    expect(store.getState().categories).toHaveLength(2);
  });

  it("seedPricebook is a no-op when the org is already seeded (empty response)", async () => {
    store.getState().setPricebook({
      services: [
        {
          id: "already-loaded",
          categoryId: null,
          code: null,
          name: "Existing Service",
          unitPrice: 100,
          cost: 20,
          laborHours: null,
          taxable: false,
          warrantyText: null,
          imageUrl: null,
          isAddon: false,
          active: true,
          position: 0,
        },
      ],
      categories: [],
    });
    mutate.seed.mockResolvedValue({ services: [], categories: [] });

    const r = await store.getState().seedPricebook();

    expect(r).toEqual({ ok: true });
    expect(store.getState().services).toHaveLength(1);
    expect(store.getState().services[0]!.id).toBe("already-loaded");
  });

  it("seedPricebook reports {ok:false, reason:'failed'} and leaves the store untouched on rejection", async () => {
    mutate.seed.mockRejectedValueOnce(new Error("boom"));

    const r = await store.getState().seedPricebook();

    expect(r).toEqual({ ok: false, reason: "failed" });
    expect(store.getState().services).toHaveLength(0);
    expect(store.getState().categories).toHaveLength(0);
  });

  // ---- materials (Phase 2a) ----------------------------------------------

  it("starts with an empty materials catalog and no service-material links", () => {
    expect(store.getState().materials).toEqual([]);
    expect(store.getState().serviceMaterials).toEqual([]);
  });

  it("setMaterials replaces the materials list", () => {
    store.getState().setMaterials([baseMaterial()]);
    expect(store.getState().materials).toHaveLength(1);
  });

  it("addMaterial optimistically appends, calls create with cents, and reconciles the server id", async () => {
    mutate.createMaterial.mockResolvedValue(baseMaterialDto({ id: "mat-server" }));

    const result = store
      .getState()
      .addMaterial({ name: "PVC coupling 2in", unitCost: 3.5 });
    expect(store.getState().materials.some((m) => m.name === "PVC coupling 2in")).toBe(true);

    await result;

    expect(mutate.createMaterial).toHaveBeenCalledTimes(1);
    const arg = mutate.createMaterial.mock.calls[0]![0] as {
      name: string;
      unitCostCents: number;
      unitOfMeasure: string;
    };
    expect(arg.name).toBe("PVC coupling 2in");
    expect(arg.unitCostCents).toBe(350); // 3.50 * 100
    expect(arg.unitOfMeasure).toBe("each"); // defaulted when omitted

    expect(store.getState().materials.some((m) => m.id === "mat-server")).toBe(true);
    expect(await result).toEqual({ ok: true });
  });

  it("addMaterial reports {ok:false, reason:'empty'} for a blank name (no persist call)", async () => {
    const r = await store.getState().addMaterial({ name: "   ", unitCost: 1 });
    expect(r).toEqual({ ok: false, reason: "empty" });
    expect(mutate.createMaterial).not.toHaveBeenCalled();
    expect(store.getState().materials).toHaveLength(0);
  });

  it("addMaterial dedupes by name (case-insensitive) before persisting", async () => {
    mutate.createMaterial.mockResolvedValue(baseMaterialDto());
    await store.getState().addMaterial({ name: "PVC coupling 2in", unitCost: 3.5 });

    const r = await store.getState().addMaterial({ name: "pvc coupling 2in", unitCost: 3.5 });
    expect(r).toEqual({ ok: false, reason: "duplicate" });
    expect(mutate.createMaterial).toHaveBeenCalledTimes(1);
    expect(store.getState().materials).toHaveLength(1);
  });

  it("addMaterial rolls back and reports {ok:false, reason:'failed'} when the persist rejects", async () => {
    mutate.createMaterial.mockRejectedValueOnce(new Error("boom"));
    const r = await store.getState().addMaterial({ name: "PVC coupling 2in", unitCost: 3.5 });
    expect(r).toEqual({ ok: false, reason: "failed" });
    expect(store.getState().materials.some((m) => m.name === "PVC coupling 2in")).toBe(false);
  });

  it("updateMaterial optimistically patches and persists cents, reconciling from the DTO", async () => {
    store.getState().setMaterials([baseMaterial({ id: "m1", unitCost: 3.5 })]);
    mutate.updateMaterial.mockResolvedValue(
      baseMaterialDto({ id: "m1", unitCostCents: 500, name: "PVC coupling 2in" }),
    );

    store.getState().updateMaterial("m1", { unitCost: 5 });
    expect(store.getState().materials[0]!.unitCost).toBe(5);

    await flush();

    expect(mutate.updateMaterial).toHaveBeenCalledWith(
      expect.objectContaining({ materialId: "m1", unitCostCents: 500 }),
    );
    expect(store.getState().materials[0]!.unitCost).toBe(5);
  });

  it("updateMaterial rolls back on rejection", async () => {
    store.getState().setMaterials([baseMaterial({ id: "m1", unitCost: 3.5 })]);
    mutate.updateMaterial.mockRejectedValueOnce(new Error("fail"));

    store.getState().updateMaterial("m1", { unitCost: 5 });
    expect(store.getState().materials[0]!.unitCost).toBe(5);

    await flush();

    expect(store.getState().materials[0]!.unitCost).toBe(3.5);
  });

  it("archiveMaterial optimistically removes and calls archive; rolls back on failure", async () => {
    store.getState().setMaterials([baseMaterial({ id: "m1" })]);
    mutate.archiveMaterial.mockRejectedValueOnce(new Error("boom"));

    store.getState().archiveMaterial("m1");
    expect(store.getState().materials).toHaveLength(0);

    await flush();

    expect(store.getState().materials.some((m) => m.id === "m1")).toBe(true);
  });

  // ---- service<->material joins (Phase 2a, lazy per-service) --------------

  it("attachMaterial optimistically adds a link and persists it", async () => {
    mutate.attachMaterial.mockResolvedValue({ ok: true });

    const result = store.getState().attachMaterial("svc-1", "mat-1", 2);
    expect(store.getState().serviceMaterials).toEqual([
      { serviceId: "svc-1", materialId: "mat-1", quantity: 2 },
    ]);

    await result;

    expect(mutate.attachMaterial).toHaveBeenCalledWith({
      serviceId: "svc-1",
      materialId: "mat-1",
      quantity: 2,
    });
    expect(await result).toEqual({ ok: true });
  });

  it("attachMaterial upserts quantity when the link already exists (no duplicate row)", async () => {
    mutate.attachMaterial.mockResolvedValue({ ok: true });
    await store.getState().attachMaterial("svc-1", "mat-1", 2);

    await store.getState().attachMaterial("svc-1", "mat-1", 5);

    expect(store.getState().serviceMaterials).toEqual([
      { serviceId: "svc-1", materialId: "mat-1", quantity: 5 },
    ]);
  });

  it("attachMaterial rejects a non-positive quantity without persisting", async () => {
    const r = await store.getState().attachMaterial("svc-1", "mat-1", 0);
    expect(r).toEqual({ ok: false, reason: "empty" });
    expect(mutate.attachMaterial).not.toHaveBeenCalled();
    expect(store.getState().serviceMaterials).toHaveLength(0);
  });

  it("attachMaterial rolls back and reports {ok:false, reason:'failed'} on rejection", async () => {
    mutate.attachMaterial.mockRejectedValueOnce(new Error("boom"));

    const r = await store.getState().attachMaterial("svc-1", "mat-1", 2);

    expect(r).toEqual({ ok: false, reason: "failed" });
    expect(store.getState().serviceMaterials).toHaveLength(0);
  });

  it("detachMaterial optimistically removes and calls detach; rolls back on failure", async () => {
    store.getState().setServiceMaterials([{ serviceId: "svc-1", materialId: "mat-1", quantity: 2 }]);
    mutate.detachMaterial.mockRejectedValueOnce(new Error("boom"));

    store.getState().detachMaterial("svc-1", "mat-1");
    expect(store.getState().serviceMaterials).toHaveLength(0);

    await flush();

    expect(store.getState().serviceMaterials).toEqual([
      { serviceId: "svc-1", materialId: "mat-1", quantity: 2 },
    ]);
  });

  it("loadServiceMaterials merges the fetched links for that service without touching others", async () => {
    store.getState().setServiceMaterials([
      { serviceId: "svc-OTHER", materialId: "mat-x", quantity: 1 },
      { serviceId: "svc-1", materialId: "mat-stale", quantity: 9 },
    ]);
    mutate.listForService.mockResolvedValue([
      { serviceId: "svc-1", materialId: "mat-1", quantity: 2 },
      { serviceId: "svc-1", materialId: "mat-2", quantity: 1 },
    ]);

    await store.getState().loadServiceMaterials("svc-1");

    expect(mutate.listForService).toHaveBeenCalledWith({ serviceId: "svc-1" });
    // The other service's link survives untouched.
    expect(
      store.getState().serviceMaterials.some((l) => l.serviceId === "svc-OTHER"),
    ).toBe(true);
    // The stale svc-1 link is gone, replaced by the fresh fetch — no duplicates/leftovers.
    expect(
      store.getState().serviceMaterials.filter((l) => l.serviceId === "svc-1"),
    ).toEqual([
      { serviceId: "svc-1", materialId: "mat-1", quantity: 2 },
      { serviceId: "svc-1", materialId: "mat-2", quantity: 1 },
    ]);
  });

  it("loadServiceMaterials leaves the store untouched and does not throw on rejection", async () => {
    store.getState().setServiceMaterials([{ serviceId: "svc-1", materialId: "mat-1", quantity: 2 }]);
    mutate.listForService.mockRejectedValueOnce(new Error("boom"));

    await expect(store.getState().loadServiceMaterials("svc-1")).resolves.toBeUndefined();

    expect(store.getState().serviceMaterials).toEqual([
      { serviceId: "svc-1", materialId: "mat-1", quantity: 2 },
    ]);
  });
});
