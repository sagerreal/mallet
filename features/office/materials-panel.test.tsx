// @vitest-environment jsdom
/**
 * The add composer is OPTIMISTIC (the house store pattern): addMaterial inserts the row in the
 * same tick, so the composer clears synchronously — it used to clear on the mutation's success,
 * leaving the same part sitting in the input AND the list for the whole round trip. A refused
 * add names the reason and restores the typed values so nothing is lost.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MaterialsPanel } from "./materials-panel";

type AddResult = { ok: true } | { ok: false; reason: string };
let mockAddMaterial: (cmd: { name: string; unitCost: number }) => Promise<AddResult> = () =>
  Promise.resolve({ ok: true });
let mockMaterials: unknown[] = [];

vi.mock("@/lib/store/app-store", () => ({
  useAppStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      materials: mockMaterials,
      addMaterial: (cmd: { name: string; unitCost: number }) => mockAddMaterial(cmd),
      updateMaterial: vi.fn(),
      archiveMaterial: vi.fn(),
    }),
}));

const nameInput = () => screen.getByLabelText("New material name") as HTMLInputElement;
const costInput = () => screen.getByLabelText("New material cost") as HTMLInputElement;

describe("MaterialsPanel — optimistic add composer", () => {
  it("clears the composer SYNCHRONOUSLY — the optimistic row is the feedback", () => {
    const calls: Array<{ name: string; unitCost: number }> = [];
    // Never settles inside this test — the clear must not wait for it.
    mockAddMaterial = (cmd) => {
      calls.push(cmd);
      return new Promise(() => {});
    };

    render(<MaterialsPanel canSeeCost={false} />);
    fireEvent.change(nameInput(), { target: { value: "3-ton condenser" } });
    fireEvent.change(costInput(), { target: { value: "1000" } });
    fireEvent.click(screen.getByRole("button", { name: "+ Add" }));

    expect(calls).toEqual([{ name: "3-ton condenser", unitCost: 1000 }]);
    expect(nameInput().value).toBe("");
    expect(costInput().value).toBe("");
  });

  it("a refused add names the reason and restores the typed values", async () => {
    mockAddMaterial = () => Promise.resolve({ ok: false, reason: "duplicate" });

    render(<MaterialsPanel canSeeCost={false} />);
    fireEvent.change(nameInput(), { target: { value: "3-ton condenser" } });
    fireEvent.change(costInput(), { target: { value: "1000" } });
    fireEvent.click(screen.getByRole("button", { name: "+ Add" }));

    await waitFor(() =>
      expect(screen.getByText(/already in your book/i)).toBeTruthy(),
    );
    expect(nameInput().value).toBe("3-ton condenser");
    expect(costInput().value).toBe("1000");
  });
});


// A PAINTER'S SHELF, in the order a painter reaches for it.
//
// The panel never sorted, so the list arrived in whatever order the repository happened to hand
// back — for the seeded painting book that was exactly backwards: sandpaper at the top and the
// eggshell used on every job at the bottom. And costs went through fmt$, which rounds to whole
// dollars: a $3.50 tube of caulk read "$4", the same defect the per-unit service rates had, on
// the one list where sub-dollar prices are the norm rather than the exception.
const mat = (over: Record<string, unknown>) => ({
  id: String(over.name), name: "x", unitCost: 1, unitPrice: 1, unitOfMeasure: "each",
  categoryId: null, code: null, description: null, markupBps: null, pricingMode: "rule",
  taxable: true, vendor: null, active: true, position: 0, ...over,
});

describe("MaterialsPanel — the shelf", () => {
  it("lists in the pack's order, not the order the rows happened to arrive", () => {
    mockMaterials = [
      mat({ name: "Sandpaper, assorted grit", position: 12 }),
      mat({ name: "Interior latex, eggshell", position: 0 }),
      mat({ name: "Painter's caulk", position: 6 }),
    ];
    const { container } = render(<MaterialsPanel canSeeCost />);

    const names = [...container.querySelectorAll(".stage-row")].map((r) => r.textContent ?? "");
    expect(names[0]).toContain("Interior latex, eggshell");
    expect(names[2]).toContain("Sandpaper");
  });

  it("keeps the cents on a sub-dollar item — a $3.50 tube is not a $4 tube", () => {
    mockMaterials = [mat({ name: "Painter's caulk", unitPrice: 3.5, unitCost: 3.5 })];
    render(<MaterialsPanel canSeeCost />);

    expect(screen.getByText("$3.50")).toBeTruthy();
    expect(screen.queryByText("$4")).toBeNull();
  });

  it("leaves a whole-dollar item alone", () => {
    mockMaterials = [mat({ name: "Canvas drop cloth, 9x12", unitPrice: 24, unitCost: 24 })];
    render(<MaterialsPanel canSeeCost />);

    expect(screen.getByText("$24")).toBeTruthy();
  });
});
