// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

interface Store {
  jobs: unknown[];
  leads: unknown[];
  techs: unknown[];
  placeVisit: () => void;
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
  placeVisit: vi.fn(), addVisit: vi.fn(), updateVisit: vi.fn(), removeVisit: vi.fn(),
});

describe("SchedulePanel — first-run empty state (board untouched)", () => {
  beforeEach(() => { storeState = store([]); q = { isFetched: true, isError: false }; vi.clearAllMocks(); });

  // Owen: "initially when this loads it shows up empty saying nothing to be scheduled and then it
  // populates." An empty list means "nothing fetched yet" for the first moment of every load, and
  // "Everything sold is scheduled." is a CLAIM — it was being made before the app had looked, then
  // contradicted a beat later when the cards arrived. A dispatcher who believes it walks away.
  it("does not claim everything is scheduled before the read lands", () => {
    storeState = store([{ id: "j1", visits: [{ id: "v1", date: "2026-08-01", techId: "t1" }] }]);
    q = { isFetched: false, isError: false };
    render(<SchedulePanel />);
    expect(screen.queryByText(/Everything sold is scheduled/)).toBeNull();
  });

  it("says it once the read lands and the tray is genuinely empty", () => {
    storeState = store([{ id: "j1", visits: [{ id: "v1", date: "2026-08-01", techId: "t1" }] }]);
    q = { isFetched: true, isError: false };
    render(<SchedulePanel />);
    expect(screen.getByText(/Everything sold is scheduled/)).toBeTruthy();
  });

  it("shows the first-run screen when loaded with nothing to schedule", () => {
    render(<SchedulePanel />);
    const frs = screen.getByText("Nothing to schedule yet").closest(".frs") as HTMLElement;
    fireEvent.click(within(frs).getByRole("button", { name: "+ New job" }));
    expect(openModal).toHaveBeenCalledWith("new-job");
  });

  it("does NOT show first-run when an estimate job exists (board has something to place)", () => {
    storeState = store([{ id: "j1", svc: "estimate", visits: [] }]);
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
