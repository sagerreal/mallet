// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

interface Store {
  jobs: unknown[];
  leads: { evisits?: unknown[] }[];
  techs: unknown[];
  placeVisit: () => void;
  placeEvisit: () => void;
  addVisit: () => void;
  updateVisit: () => void;
  removeVisit: () => void;
}
let storeState: Store;
let q = { isFetched: true, isError: false };
const openModal = vi.fn();

vi.mock("@/lib/store/app-store", () => ({
  useAppStore: (sel: (s: Store) => unknown) => sel(storeState),
  useOpenModal: () => openModal,
}));
vi.mock("@/lib/trpc/client", () => ({ api: { v1: { jobs: { list: { useQuery: () => q }, viewCounts: { useQuery: () => ({ data: undefined, isFetched: true }) } } } } }));

import { SchedulePanel } from "./schedule-panel";

const store = (jobs: unknown[], leads: Store["leads"] = []): Store => ({
  jobs, leads, techs: [],
  placeVisit: vi.fn(), placeEvisit: vi.fn(), addVisit: vi.fn(), updateVisit: vi.fn(), removeVisit: vi.fn(),
});

describe("SchedulePanel — first-run empty state (board untouched)", () => {
  beforeEach(() => { storeState = store([]); q = { isFetched: true, isError: false }; vi.clearAllMocks(); });

  it("shows the first-run screen when loaded with nothing to schedule", () => {
    render(<SchedulePanel />);
    const frs = screen.getByText("Nothing to schedule yet").closest(".frs") as HTMLElement;
    fireEvent.click(within(frs).getByRole("button", { name: "+ New job" }));
    expect(openModal).toHaveBeenCalledWith("new-job");
  });

  it("does NOT show first-run when a lead carries an estimate visit (board has something to place)", () => {
    storeState = store([], [{ evisits: [{ id: "v1" }] }]);
    render(<SchedulePanel />);
    expect(screen.queryByText("Nothing to schedule yet")).toBeNull();
  });

  it("shows the quiet loading state on cold load — not the first-run flash", () => {
    q = { isFetched: false, isError: false };
    render(<SchedulePanel />);
    expect(screen.queryByText("Nothing to schedule yet")).toBeNull();
    expect(screen.getByText("Loading…")).toBeTruthy();
  });

  it("shows the load-failed state — not the first-run screen — when the load errored", () => {
    q = { isFetched: true, isError: true };
    render(<SchedulePanel />);
    expect(screen.queryByText("Nothing to schedule yet")).toBeNull();
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});
