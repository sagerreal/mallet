import { describe, it, expect, vi, beforeEach } from "vitest";
import { createStore, type StoreApi } from "zustand/vanilla";
import { createChecklistsSlice, type ChecklistsSlice } from "./checklists-slice";

const mutate = {
  create: vi.fn(),
  remove: vi.fn(),
  addItem: vi.fn(),
  removeItem: vi.fn(),
  setItemRequired: vi.fn(),
};

vi.mock("@/lib/trpc/vanilla", () => ({
  trpcVanilla: {
    v1: {
      checklists: {
        create: { mutate: (...a: unknown[]) => mutate.create(...a) },
        remove: { mutate: (...a: unknown[]) => mutate.remove(...a) },
        addItem: { mutate: (...a: unknown[]) => mutate.addItem(...a) },
        removeItem: { mutate: (...a: unknown[]) => mutate.removeItem(...a) },
        setItemRequired: { mutate: (...a: unknown[]) => mutate.setItemRequired(...a) },
      },
    },
  },
}));

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("checklistsSlice", () => {
  let store: StoreApi<ChecklistsSlice>;

  beforeEach(() => {
    vi.clearAllMocks();
    store = createStore<ChecklistsSlice>((set, get, api) =>
      createChecklistsSlice(set, get, api),
    );
  });

  it("starts empty (no SEED_CHECKLISTS)", () => {
    expect(store.getState().checklists).toEqual([]);
  });

  it("setChecklists replaces the slice", () => {
    store.getState().setChecklists([
      { id: "x", name: "Y", trade: "Custom", stage: "job", match: [], items: [] },
    ]);
    expect(store.getState().checklists).toHaveLength(1);
  });

  it("addChecklist optimistically appends and calls v1.checklists.create with the client id", () => {
    mutate.create.mockResolvedValue({ id: "will-be-ignored", name: "Repipe", trade: "Custom", stage: "job", match: [], items: [], createdAt: "" });
    const { checklist } = store.getState().addChecklist("Repipe", "job");
    expect(store.getState().checklists).toHaveLength(1);
    expect(mutate.create).toHaveBeenCalledWith(
      expect.objectContaining({ id: checklist.id, name: "Repipe", stage: "job" }),
    );
  });

  it("addChecklist rolls back on persist failure", async () => {
    mutate.create.mockRejectedValue(new Error("boom"));
    const { checklist } = store.getState().addChecklist("Repipe", "job");
    await flush();
    expect(store.getState().checklists.some((c) => c.id === checklist.id)).toBe(false);
  });

  it("deleteChecklist optimistically removes and calls remove; rolls back on failure", async () => {
    store.getState().setChecklists([{ id: "c1", name: "A", trade: "Custom", stage: "job", match: [], items: [] }]);
    mutate.remove.mockRejectedValue(new Error("boom"));
    store.getState().deleteChecklist("c1");
    expect(store.getState().checklists).toHaveLength(0);
    await flush();
    expect(store.getState().checklists.some((c) => c.id === "c1")).toBe(true);
  });

  it("addChecklistItem appends optimistically, reconciles server ids from the returned DTO", async () => {
    store.getState().setChecklists([{ id: "c1", name: "A", trade: "Custom", stage: "job", match: [], items: [] }]);
    mutate.addItem.mockResolvedValue({
      id: "c1", name: "A", trade: "Custom", stage: "job", match: [], createdAt: "",
      items: [{ id: "server-item-1", text: "Photo", type: "photo", required: false, position: 0 }],
    });
    store.getState().addChecklistItem("c1", "Photo of X", "photo");
    expect(store.getState().checklists[0]!.items).toHaveLength(1);
    await flush();
    expect(store.getState().checklists[0]!.items[0]!.id).toBe("server-item-1");
  });

  it("toggleItemRequired flips optimistically and calls setItemRequired with the new value", () => {
    store.getState().setChecklists([{
      id: "c1", name: "A", trade: "Custom", stage: "job", match: [],
      items: [{ id: "i1", text: "x", type: "check", required: false, position: 0 }],
    }]);
    mutate.setItemRequired.mockResolvedValue({ id: "c1", name: "A", trade: "Custom", stage: "job", match: [], createdAt: "", items: [{ id: "i1", text: "x", type: "check", required: true, position: 0 }] });
    store.getState().toggleItemRequired("c1", "i1");
    expect(store.getState().checklists[0]!.items[0]!.required).toBe(true);
    expect(mutate.setItemRequired).toHaveBeenCalledWith({ checklistId: "c1", itemId: "i1", required: true });
  });
});
