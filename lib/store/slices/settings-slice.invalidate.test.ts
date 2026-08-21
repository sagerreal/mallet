// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";

/**
 * A toggle save has to reach the SETTINGS READS, not just the store.
 *
 * The bug this pins: `setToggle` wrote to the server and to the store and invalidated nothing.
 * Both settings queries are cached for 30s and `SettingsHydrator` calls `setSettings` on every
 * mount, so leaving Settings and coming back inside that window re-seeded the store from the
 * pre-click payload and painted the switch back to its old position. The write had succeeded — the
 * screen said it hadn't, which is the shape every user reads as "it won't save".
 */

let resolveUpdate: (v: unknown) => void = () => {};
let rejectUpdate: (e: unknown) => void = () => {};
const updateMutate = vi.fn(
  () =>
    new Promise((res, rej) => {
      resolveUpdate = res;
      rejectUpdate = rej;
    }),
);

vi.mock("@/lib/trpc/vanilla", () => ({
  trpcVanilla: {
    v1: {
      settings: {
        updateConfig: { mutate: (...a: unknown[]) => updateMutate(...(a as [])) },
      },
    },
  },
}));

import { registerListCache, resetListCache } from "@/lib/trpc/list-cache";
import { useAppStore } from "@/lib/store/app-store";

describe("a toggle save refreshes the settings reads that render it", () => {
  let qc: QueryClient;
  let invalidate: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    qc = new QueryClient();
    invalidate = vi.spyOn(qc, "invalidateQueries").mockResolvedValue(undefined);
    registerListCache(qc);
    updateMutate.mockClear();
  });

  afterEach(() => {
    resetListCache();
    vi.restoreAllMocks();
  });

  /** Every key this call asked React Query to invalidate, flattened for readability. */
  const keysInvalidated = (): string =>
    invalidate.mock.calls
      .map((c: unknown[]) => JSON.stringify((c[0] as { queryKey: unknown }).queryKey))
      .join(" ");

  it("does NOT refetch while the write is still in flight", async () => {
    useAppStore.getState().setToggle("techEditsTimes", true);

    await Promise.resolve();
    expect(updateMutate).toHaveBeenCalledWith({ techEditsTimes: true });
    expect(
      invalidate,
      "a refetch started before the commit returns the PRE-write value and paints it back",
    ).not.toHaveBeenCalled();
  });

  it("refetches the office settings read once the server confirms", async () => {
    useAppStore.getState().setToggle("techEditsTimes", true);
    resolveUpdate({});
    await new Promise((r) => setTimeout(r, 0));

    expect(keysInvalidated()).toContain("settings");
  });

  // The office and the crew read DIFFERENT queries. Refreshing only the office copy is why the
  // switch moved on the owner's screen while My hours kept saying "changes go through the office".
  it("refetches the technician's fieldToggles read too, not just the office one", async () => {
    useAppStore.getState().setToggle("techEditsTimes", true);
    resolveUpdate({});
    await new Promise((r) => setTimeout(r, 0));

    const keys = keysInvalidated();
    expect(keys).toContain("fieldToggles");
    expect(keys).toContain("get");
  });

  it("rolls back and refetches nothing when the write fails", async () => {
    const before = useAppStore.getState().toggles.techEditsTimes;
    useAppStore.getState().setToggle("techEditsTimes", !before);
    rejectUpdate(new Error("econnrefused"));
    await new Promise((r) => setTimeout(r, 0));

    expect(useAppStore.getState().toggles.techEditsTimes).toBe(before);
    expect(
      invalidate,
      "a failed write must not refetch: the rollback is already correct and a refetch only adds load",
    ).not.toHaveBeenCalled();
  });
});
