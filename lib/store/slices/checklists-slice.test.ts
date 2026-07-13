import { describe, it, expect, vi, beforeEach } from "vitest";
import { createStore, type StoreApi } from "zustand/vanilla";
import { createChecklistsSlice, type ChecklistsSlice } from "./checklists-slice";

const mutate = {
  create: vi.fn(),
  remove: vi.fn(),
};

vi.mock("@/lib/trpc/vanilla", () => ({
  trpcVanilla: {
    v1: {
      checklists: {
        create: { mutate: (...a: unknown[]) => mutate.create(...a) },
        remove: { mutate: (...a: unknown[]) => mutate.remove(...a) },
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

  it("addChecklist sends template AND items in ONE create call (client ids preserved)", () => {
    mutate.create.mockResolvedValue({
      id: "ignored", name: "Repipe", trade: "Custom", stage: "job", match: [], items: [], createdAt: "",
    });
    const { checklist } = store.getState().addChecklist("Repipe", "job", [
      { text: "Photo of the manifold", type: "photo", required: true },
      { text: "Pressure test", type: "check", required: true },
    ]);
    // Optimistic: template + both items appear immediately.
    expect(store.getState().checklists).toHaveLength(1);
    expect(store.getState().checklists[0]!.items).toHaveLength(2);
    expect(store.getState().checklists[0]!.items.map((i) => i.position)).toEqual([0, 1]);
    // ONE mutation carries everything — no separate addItem calls to race the create.
    expect(mutate.create).toHaveBeenCalledOnce();
    expect(mutate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        id: checklist.id,
        name: "Repipe",
        stage: "job",
        items: [
          expect.objectContaining({ text: "Photo of the manifold", type: "photo", required: true }),
          expect.objectContaining({ text: "Pressure test", type: "check", required: true }),
        ],
      }),
    );
  });

  it("addChecklist persisted resolves with the reconciled (server) checklist", async () => {
    mutate.create.mockImplementation(async (input: { id: string }) => ({
      id: input.id, name: "Server Name", trade: "Custom", stage: "job", match: [],
      items: [{ id: "srv-i1", text: "X", type: "check", required: true, position: 0 }],
      createdAt: "",
    }));
    const { persisted } = store
      .getState()
      .addChecklist("Local", "job", [{ text: "X", type: "check", required: true }]);
    const reconciled = await persisted;
    expect(reconciled.name).toBe("Server Name");
    expect(reconciled.items[0]!.id).toBe("srv-i1");
    expect(store.getState().checklists[0]!.name).toBe("Server Name");
  });

  it("addChecklist rolls back AND rejects on persist failure (caller must surface it)", async () => {
    mutate.create.mockRejectedValue(new Error("boom"));
    const { checklist, persisted } = store.getState().addChecklist("Repipe", "job");
    await expect(persisted).rejects.toThrow("boom");
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
});
