// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

interface Store { checklists: { id: string; name: string }[]; addChecklist: () => void }
let storeState: Store;
let q = { isFetched: true, isError: false };

vi.mock("@/lib/store/app-store", () => ({ useAppStore: (sel: (s: Store) => unknown) => sel(storeState) }));
vi.mock("@/lib/trpc/client", () => ({ api: { v1: { checklists: { list: { useQuery: () => q } } } } }));
vi.mock("./checklist-editor-card", () => ({ ChecklistEditorCard: () => <div data-testid="cl-card" /> }));
vi.mock("./add-checklist-modal", () => ({ AddChecklistModal: () => null }));
vi.mock("./starter-checklists-modal", () => ({ StarterChecklistsModal: () => null }));

import { ChecklistsPanel } from "./checklists-panel";

const store = (checklists: Store["checklists"]): Store => ({ checklists, addChecklist: vi.fn() });

describe("ChecklistsPanel — first-run empty state", () => {
  beforeEach(() => { storeState = store([]); q = { isFetched: true, isError: false }; });

  it("shows the first-run screen when loaded and empty", () => {
    render(<ChecklistsPanel />);
    expect(screen.getByText("No checklists yet")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Choose trade" })).toBeTruthy();
    expect(screen.queryByTestId("cl-card")).toBeNull();
  });

  it("shows the list once checklists exist", () => {
    storeState = store([{ id: "c1", name: "Install" }]);
    render(<ChecklistsPanel />);
    expect(screen.getByTestId("cl-card")).toBeTruthy();
    expect(screen.queryByText("No checklists yet")).toBeNull();
  });

  it("shows neither while the list is still loading (no flash)", () => {
    q = { isFetched: false, isError: false };
    render(<ChecklistsPanel />);
    expect(screen.queryByText("No checklists yet")).toBeNull();
    expect(screen.queryByTestId("cl-card")).toBeNull();
  });
});
