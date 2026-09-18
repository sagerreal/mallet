/**
 * lib/store/slices/assemblies-slice.test.ts
 * The assemblies slice persistence layer: optimistic dial apply, the wire
 * payload (raw units straight through — no dollars conversion), reconcile
 * adopting the server row (including the catalog:→uuid id swap on first
 * materialization), rollback + surfaced outcome on failure, and archive's
 * optimistic remove/rollback. trpcVanilla module-mocked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createStore, type StoreApi } from "zustand/vanilla";
import { createAssembliesSlice, type AssembliesSlice } from "./assemblies-slice";
import type { AssemblyView } from "../assemblies-mapper";

const mutate = {
  saveDial: vi.fn(),
  archive: vi.fn(),
};

vi.mock("@/lib/trpc/vanilla", () => ({
  trpcVanilla: {
    v1: {
      assemblies: {
        saveDial: { mutate: (...a: unknown[]) => mutate.saveDial(...a) },
        archive: { mutate: (...a: unknown[]) => mutate.archive(...a) },
      },
    },
  },
}));

const view = (overrides: Partial<AssemblyView> = {}): AssemblyView =>
  ({
    id: "catalog:sealcoat_two_coats",
    catalogKey: "sealcoat_two_coats",
    name: "Sealcoat, two coats",
    measurementBasis: "area",
    pricingMode: "unit_rate",
    marginBps: 0,
    jobMinimumCents: 35_000,
    config: { version: 1, components: [], tiers: [{ upToQty: null, rateCents: 25 }] },
    active: true,
    isOverride: false,
    dials: [
      {
        key: "job_min",
        label: "Job minimum",
        format: "dollars",
        unitSuffix: null,
        currentRaw: 35_000,
        defaultRaw: 35_000,
      },
    ],
    ...overrides,
  }) as AssemblyView;

let store: StoreApi<AssembliesSlice>;

beforeEach(() => {
  vi.clearAllMocks();
  store = createStore<AssembliesSlice>()((...args) => createAssembliesSlice(...args));
  store.getState().setAssemblies([view()]);
});

describe("saveAssemblyDial", () => {
  it("applies the dial optimistically and sends RAW units on the wire", async () => {
    mutate.saveDial.mockReturnValue(new Promise(() => {})); // never resolves
    void store.getState().saveAssemblyDial("catalog:sealcoat_two_coats", "job_min", 50_000);
    expect(store.getState().assemblies[0]!.dials[0]!.currentRaw).toBe(50_000);
    expect(mutate.saveDial).toHaveBeenCalledWith({
      assemblyId: "catalog:sealcoat_two_coats",
      dialKey: "job_min",
      rawValue: 50_000,
    });
  });

  it("reconciles the server row, swapping the synthetic catalog id for the row uuid", async () => {
    const serverRow = view({
      id: "11111111-1111-1111-1111-111111111111",
      isOverride: true,
      jobMinimumCents: 50_000,
      dials: [
        {
          key: "job_min",
          label: "Job minimum",
          format: "dollars",
          unitSuffix: null,
          currentRaw: 50_000,
          defaultRaw: 35_000,
        },
      ],
    });
    mutate.saveDial.mockResolvedValue(serverRow);
    const result = await store
      .getState()
      .saveAssemblyDial("catalog:sealcoat_two_coats", "job_min", 50_000);
    expect(result.ok).toBe(true);
    const items = store.getState().assemblies;
    expect(items).toHaveLength(1);
    expect(items[0]!.id).toBe("11111111-1111-1111-1111-111111111111");
    expect(items[0]!.isOverride).toBe(true);
    expect(items[0]!.jobMinimumCents).toBe(50_000);
  });

  it("rolls back and surfaces { ok: false } on a failed persist", async () => {
    mutate.saveDial.mockRejectedValue(new Error("network"));
    const result = await store
      .getState()
      .saveAssemblyDial("catalog:sealcoat_two_coats", "job_min", 50_000);
    expect(result.ok).toBe(false);
    expect(store.getState().assemblies[0]!.dials[0]!.currentRaw).toBe(35_000);
  });

  it("a stale response never clobbers a newer edit (last write wins)", async () => {
    let resolveFirst!: (v: unknown) => void;
    mutate.saveDial
      .mockImplementationOnce(() => new Promise((res) => (resolveFirst = res)))
      .mockImplementationOnce(() =>
        Promise.resolve(
          view({
            id: "11111111-1111-1111-1111-111111111111",
            isOverride: true,
            dials: [
              {
                key: "job_min",
                label: "Job minimum",
                format: "dollars",
                unitSuffix: null,
                currentRaw: 60_000,
                defaultRaw: 35_000,
              },
            ],
          }),
        ),
      );
    const first = store.getState().saveAssemblyDial("catalog:sealcoat_two_coats", "job_min", 50_000);
    const second = store.getState().saveAssemblyDial("catalog:sealcoat_two_coats", "job_min", 60_000);
    await second;
    // First (stale) resolves AFTER the second reconciled — must be ignored.
    resolveFirst(
      view({
        id: "11111111-1111-1111-1111-111111111111",
        isOverride: true,
        dials: [
          {
            key: "job_min",
            label: "Job minimum",
            format: "dollars",
            unitSuffix: null,
            currentRaw: 50_000,
            defaultRaw: 35_000,
          },
        ],
      }),
    );
    await first;
    expect(store.getState().assemblies[0]!.dials[0]!.currentRaw).toBe(60_000);
  });
});

describe("archiveAssembly", () => {
  it("removes optimistically and persists", () => {
    mutate.archive.mockResolvedValue({ ok: true });
    store.getState().archiveAssembly("catalog:sealcoat_two_coats");
    expect(store.getState().assemblies).toHaveLength(0);
    expect(mutate.archive).toHaveBeenCalledWith({ assemblyId: "catalog:sealcoat_two_coats" });
  });

  it("rolls back on a failed archive", async () => {
    let rejectIt!: (e: unknown) => void;
    mutate.archive.mockImplementation(() => new Promise((_res, rej) => (rejectIt = rej)));
    store.getState().archiveAssembly("catalog:sealcoat_two_coats");
    expect(store.getState().assemblies).toHaveLength(0);
    rejectIt(new Error("network"));
    await vi.waitFor(() => expect(store.getState().assemblies).toHaveLength(1));
  });
});
