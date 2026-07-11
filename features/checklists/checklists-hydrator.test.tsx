import { describe, it, expect } from "vitest";
import { toStoreChecklist } from "./checklists-hydrator";

describe("toStoreChecklist", () => {
  it("maps a checklist DTO to the store shape, preserving item order + ids", () => {
    const store = toStoreChecklist({
      id: "11111111-1111-1111-1111-111111111111",
      name: "Water heater",
      trade: "Plumbing",
      stage: "job",
      match: ["water heater"],
      createdAt: "2026-07-01T00:00:00.000Z",
      items: [
        { id: "aaaa", text: "Photo", type: "photo", required: true, position: 0 },
        { id: "bbbb", text: "Test valve", type: "check", required: false, position: 1 },
      ],
    });
    expect(store.id).toBe("11111111-1111-1111-1111-111111111111");
    expect(store.stage).toBe("job");
    expect(store.items.map((i) => i.id)).toEqual(["aaaa", "bbbb"]);
    const [first] = store.items;
    expect(first?.type).toBe("photo");
    expect(first?.required).toBe(true);
  });
});
