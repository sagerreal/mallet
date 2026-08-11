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

vi.mock("@/lib/store/app-store", () => ({
  useAppStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      materials: [],
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
