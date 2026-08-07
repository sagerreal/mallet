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

/** What useWorkBoard reports — the three states the Today pane branches on. */
let boardState: { needsYou: { count: number; valueDollars: number; textsReady: number }; isFetched: boolean; isError: boolean };

const openModal = vi.fn();
/** The pane's own card→modal mapping, captured off the board it hands it to. */
let onOpen: (item: { kind: string; refId: string }) => void;

vi.mock("@/lib/store/app-store", () => ({
  useAppStore: (sel: (s: Store) => unknown) => sel(storeState),
  useOpenModal: () => openModal,
}));
vi.mock("@/features/identity/hooks", () => ({ useMe: () => ({ data: { orgName: "Rivera Plumbing", name: "Owen D", email: "o@x.com" } }) }));
vi.mock("@/features/home/derive", () => ({ deriveShiftReport: () => ({}), deriveOkQueue: () => [] }));
vi.mock("@/features/home/handoff-note", () => ({ HandoffNote: () => <div data-testid="handoff" /> }));
// The pane's only remaining tRPC use is the retry's cache invalidation — these tests are about
// the tab shell, so it's a no-op.
vi.mock("@/lib/trpc/client", () => ({
  api: { useUtils: () => ({ v1: { invalidate: () => Promise.resolve() } }) },
}));
// Today is the board now. Stubbed at the hook + component seam: what those render is covered by
// features/board's own tests, and these tests are about the tab shell.
vi.mock("@/features/board/use-work-board", () => ({
  useWorkBoard: () => boardState,
}));
vi.mock("@/features/board/work-board", () => ({
  WorkBoard: (props: { onOpen: typeof onOpen }) => {
    onOpen = props.onOpen;
    return <div data-testid="board" />;
  },
  WorkBoardSkeleton: () => <div data-testid="board-skeleton" />,
}));
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
    boardState = { needsYou: { count: 0, valueDollars: 0, textsReady: 0 }, isFetched: true, isError: false };
    openModal.mockClear();
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

  it("Today is the board: a settled read renders it under the handoff note", () => {
    render(<OfficePage />);
    expect(screen.getByTestId("board")).toBeTruthy();
    expect(screen.queryByTestId("board-skeleton")).toBeNull();
  });

  it("first read in flight → the board's own skeleton, never an empty four-column board", () => {
    boardState = { ...boardState, isFetched: false };
    render(<OfficePage />);
    expect(screen.getByTestId("board-skeleton")).toBeTruthy();
    expect(screen.queryByTestId("board")).toBeNull();
  });

  // The whole point of a card: it opens the record it IS. A kind wired to the wrong modal sends the
  // owner to somebody else's record, and only one of the four kinds has rows in the E2E fixture.
  it.each([
    ["lead", "lead", { leadId: "L1" }],
    ["estimate", "est", { estId: "L1" }],
    ["job", "job", { jobId: "L1" }],
    ["invoice", "invoice", { invoiceId: "L1" }],
  ])("a %s card opens the %s modal with its own id", (kind, modalId, payload) => {
    render(<OfficePage />);
    onOpen({ kind, refId: "L1" });
    expect(openModal).toHaveBeenCalledWith(modalId, payload);
  });

  it("errored with nothing cached → LoadFailed with a retry, never four empty columns", () => {
    boardState = { ...boardState, isFetched: false, isError: true };
    render(<OfficePage />);
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(screen.queryByTestId("board")).toBeNull();
    expect(screen.queryByTestId("board-skeleton")).toBeNull();
  });
});
