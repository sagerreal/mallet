import { describe, it, expect, beforeEach, vi } from "vitest";
import { createStore, type StoreApi } from "zustand/vanilla";
import { createDataSlice, type DataSlice } from "./data-slice";
import { trpcVanilla } from "@/lib/trpc/vanilla";

vi.mock("@/lib/trpc/vanilla", () => ({
  trpcVanilla: { v1: { settings: { updateBrand: { mutate: vi.fn() } }, companies: { create: { mutate: vi.fn() }, update: { mutate: vi.fn() } } } },
}));

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("data-slice brand actions", () => {
  let store: StoreApi<DataSlice>;
  beforeEach(() => {
    vi.clearAllMocks();
    store = createStore<DataSlice>((set, get, api) => createDataSlice(set, get, api));
  });

  it("setBrand replaces the whole brand", () => {
    store.getState().setBrand({ name: "Rivera", initials: "RP", color: "#9C5B34", site: "r.com", tagline: "tg" });
    expect(store.getState().brand.name).toBe("Rivera");
    expect(store.getState().brand.color).toBe("#9C5B34");
  });

  it("updateBrand optimistically patches, then reconciles from the DTO", async () => {
    (trpcVanilla.v1.settings.updateBrand.mutate as ReturnType<typeof vi.fn>).mockResolvedValue({
      brand: { name: "Rivera Plumbing", tagline: "Licensed", site: "r.com", color: "#000000", logoUrl: null, initials: "RP" },
    });
    store.getState().updateBrand({ color: "#111111" });
    // Optimistic value applied synchronously.
    expect(store.getState().brand.color).toBe("#111111");
    await flush();
    // Server canonical value reconciled (server normalised colour).
    expect(store.getState().brand.color).toBe("#000000");
    expect(store.getState().brand.name).toBe("Rivera Plumbing");
    expect(trpcVanilla.v1.settings.updateBrand.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ color: "#111111" }),
    );
  });

  it("updateBrand rolls back to the snapshot on error", async () => {
    store.getState().setBrand({ name: "Keep", initials: "KP", color: "#abcabc", site: "keep.com", tagline: "safe" });
    (trpcVanilla.v1.settings.updateBrand.mutate as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("network"));
    store.getState().updateBrand({ name: "Doomed" });
    expect(store.getState().brand.name).toBe("Doomed"); // optimistic
    await flush();
    expect(store.getState().brand.name).toBe("Keep"); // rolled back
  });
});
