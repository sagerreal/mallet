// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

interface Store {
  toggles: { frontDesk: boolean };
  services: unknown[];
  checklists: unknown[];
  leads: unknown[]; estimates: unknown[]; invoices: unknown[]; jobs: unknown[]; techs: unknown[];
  dismissedAttention: unknown[];
}
let storeState: Store;

vi.mock("@/lib/store/app-store", () => ({ useAppStore: (sel: (s: Store) => unknown) => sel(storeState) }));
vi.mock("@/features/identity/hooks", () => ({ useMe: () => ({ data: { orgName: "Rivera Plumbing", name: "Owen D", email: "o@x.com" } }) }));
vi.mock("@/features/home/derive", () => ({ deriveShiftReport: () => ({}), deriveOkQueue: () => [] }));
vi.mock("@/features/home/pipe", () => ({ deriveHomePipe: () => [] }));
vi.mock("@/features/home/handoff-note", () => ({ HandoffNote: () => <div data-testid="handoff" /> }));
vi.mock("@/features/home/home-pipe", () => ({ HomePipe: () => <div /> }));
vi.mock("@/features/home/ok-queue", () => ({ OkQueue: () => <div /> }));
vi.mock("@/features/office/front-desk-pane", () => ({ FrontDeskPane: () => <div data-testid="fd-pane" /> }));
vi.mock("@/features/office/pricebook-pane", () => ({ PricebookPane: () => <div data-testid="pb-pane" /> }));
vi.mock("@/features/jobs/checklists-panel", () => ({ ChecklistsPanel: () => <div data-testid="cl-pane" /> }));

import OfficePage from "./page";

describe("Office page — one tab bar, four panes", () => {
  beforeEach(() => {
    storeState = {
      toggles: { frontDesk: true }, services: [{ id: "s1" }], checklists: [],
      leads: [], estimates: [], invoices: [], jobs: [], techs: [], dismissedAttention: [],
    };
    window.history.replaceState(null, "", "/dashboard");
  });

  it("lands on Today with all four tabs visible (counts on Pricebook, none on empty Checklists)", () => {
    render(<OfficePage />);
    expect(screen.getByTestId("handoff")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Today" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Front Desk/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Pricebook 1/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Checklists" })).toBeTruthy();
  });

  it("tabbing over swaps the pane in place — no navigation", async () => {
    render(<OfficePage />);
    fireEvent.click(screen.getByRole("tab", { name: /Front Desk/ }));
    // Panes are code-split (next/dynamic) — resolution is async, so find*.
    expect(await screen.findByTestId("fd-pane")).toBeTruthy();
    expect(screen.queryByTestId("handoff")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: /Pricebook/ }));
    expect(await screen.findByTestId("pb-pane")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Checklists" }));
    expect(await screen.findByTestId("cl-pane")).toBeTruthy();
  });

  it("deep-links: ?tab=pricebook opens the Pricebook pane directly", async () => {
    window.history.replaceState(null, "", "/dashboard?tab=pricebook");
    render(<OfficePage />);
    expect(await screen.findByTestId("pb-pane")).toBeTruthy();
    expect(screen.queryByTestId("handoff")).toBeNull();
  });
});
