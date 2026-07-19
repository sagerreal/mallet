// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

interface Store {
  laborRates: { id: string; name: string; rate: number; kind: string }[];
  addLaborRate: (name: string, rate: number, kind: string) => void;
  updateLaborRate: () => void;
  removeLaborRate: () => void;
  markup: number;
  setMarkup: () => void;
  terms: { id: string; t: string; body: string }[];
  addTerm: () => void;
  removeTerm: () => void;
}
let storeState: Store;
const addLaborRate = vi.fn();

vi.mock("@/lib/store/app-store", () => ({ useAppStore: (sel: (s: Store) => unknown) => sel(storeState) }));
vi.mock("../settings/pricebook-card", () => ({ PricebookCard: () => <div data-testid="pricebook-card" /> }));
vi.mock("../settings/estimator-memory-card", () => ({ EstimatorMemoryCard: () => <div data-testid="memory-card" /> }));

import PricebookPage from "./page";

describe("PricebookPage — the promoted pricing surface", () => {
  beforeEach(() => {
    storeState = {
      laborRates: [{ id: "r1", name: "Standard", rate: 120, kind: "hourly" }],
      addLaborRate, updateLaborRate: vi.fn(), removeLaborRate: vi.fn(),
      markup: 35, setMarkup: vi.fn(),
      terms: [], addTerm: vi.fn(), removeTerm: vi.fn(),
    };
    vi.clearAllMocks();
  });

  it("renders the page with the pricebook, labor rates, memory, and quiet defaults", () => {
    render(<PricebookPage />);
    expect(screen.getByRole("heading", { name: "Pricebook" })).toBeTruthy();
    expect(screen.getByTestId("pricebook-card")).toBeTruthy();
    expect(screen.getByText("Labor rates")).toBeTruthy();
    expect(screen.getByTestId("memory-card")).toBeTruthy();
    // Markup + terms ride along as quiet defaults at the bottom.
    expect(screen.getByText("Defaults")).toBeTruthy();
    expect(screen.getByText("Default parts markup")).toBeTruthy();
    expect(screen.getByText("Terms library")).toBeTruthy();
  });

  it("adding a labor rate calls the store action with name, rate, and kind", () => {
    render(<PricebookPage />);
    fireEvent.change(screen.getByPlaceholderText("e.g. Diagnostic fee, After-hours"), { target: { value: "After-hours" } });
    fireEvent.change(screen.getByPlaceholderText("$/hr"), { target: { value: "180" } });
    // Two "+ Add" buttons exist (labor rates + terms); the labor one renders first.
    fireEvent.click(screen.getAllByRole("button", { name: "+ Add" })[0]!);
    expect(addLaborRate).toHaveBeenCalledWith("After-hours", 180, "hourly");
  });
});
