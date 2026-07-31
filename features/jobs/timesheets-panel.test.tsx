// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

interface Store {
  techs: { id: string; name: string }[];
  jobs: unknown[];
  leads: unknown[];
  timeEntries: unknown[];
  addTimeEntry: () => void;
  updateTimeEntry: () => void;
  deleteTimeEntry: () => void;
  approveTechWeek: () => void;
  reopenEntry: () => void;
  setTimeEntries: (entries: unknown[]) => void;
}
let storeState: Store;
let q = { isFetched: true, isError: false };
// The gate counts entries in the DATABASE, not the rows loaded for the week on screen. Those are
// different numbers the moment the user pages to a quiet week — see the regression test below.
let everTotal = 0;
const push = vi.fn();

vi.mock("@/lib/store/app-store", () => ({ useAppStore: (sel: (s: Store) => unknown) => sel(storeState) }));
vi.mock("@/lib/trpc/client", () => ({
  api: {
    v1: {
      timesheets: {
        list: { useQuery: () => ({ ...q, data: { items: [] } }) },
        count: { useQuery: () => ({ ...q, data: { total: everTotal } }) },
      },
    },
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("./timesheets-crew", () => ({ TsCrewChips: () => <div data-testid="crew" />, TsTechWeekCard: () => <div /> }));

import { TimesheetsPanel } from "./timesheets-panel";

const store = (timeEntries: unknown[], techs: Store["techs"] = []): Store => ({
  techs, jobs: [], leads: [], timeEntries,
  addTimeEntry: vi.fn(), updateTimeEntry: vi.fn(), deleteTimeEntry: vi.fn(), approveTechWeek: vi.fn(), reopenEntry: vi.fn(),
  setTimeEntries: vi.fn(),
});

describe("TimesheetsPanel — first-run empty state", () => {
  beforeEach(() => { storeState = store([]); q = { isFetched: true, isError: false }; everTotal = 0; vi.clearAllMocks(); });

  it("shows the first-run screen when loaded and no hours are logged", () => {
    render(<TimesheetsPanel />);
    expect(screen.getByText("No hours logged yet")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Set up crew" })).toBeTruthy();
  });

  it("offers the manual-entry path only when there is a crew member", () => {
    storeState = store([]); // no crew → no manual entry button
    const { unmount } = render(<TimesheetsPanel />);
    expect(screen.queryByRole("button", { name: "+ Add entry" })).toBeNull();
    unmount();

    storeState = store([], [{ id: "t1", name: "Mike" }]);
    render(<TimesheetsPanel />);
    expect(screen.getByRole("button", { name: "+ Add entry" })).toBeTruthy();
  });

  // Owen, with two field crew already set up: "why is this occurring when I have a crew?"
  // The screen was telling him to do a step he had finished, and putting it AHEAD of the one thing
  // he could actually do. "No hours" has two different causes and only one is about a missing crew.
  describe("when a crew already exists", () => {
    beforeEach(() => {
      storeState = store([], [{ id: "t1", name: "Mike" }]);
    });

    it("does not tell the shop to set up a crew it already has", () => {
      render(<TimesheetsPanel />);
      expect(screen.queryByRole("button", { name: "Set up crew" })).toBeNull();
    });

    it("makes logging time the primary action, because that is what is left to do", () => {
      render(<TimesheetsPanel />);
      expect(screen.getByRole("button", { name: "+ Add entry" })).toBeTruthy();
    });

    it("explains that hours arrive when the crew starts a job, rather than blaming setup", () => {
      render(<TimesheetsPanel />);
      expect(screen.getByText(/as soon as they start a job/i)).toBeTruthy();
    });
  });

  describe("when there is no crew yet", () => {
    it("asks for a crew, and does not offer an entry that would belong to nobody", () => {
      storeState = store([]);
      render(<TimesheetsPanel />);
      expect(screen.getByRole("button", { name: "Set up crew" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "+ Add entry" })).toBeNull();
    });
  });

  it("shows the quiet loading state on cold load — not the first-run flash", () => {
    q = { isFetched: false, isError: false };
    render(<TimesheetsPanel />);
    expect(screen.queryByText("No hours logged yet")).toBeNull();
    expect(screen.getByText("Loading…")).toBeTruthy();
  });

  it("shows the load-failed state — not the first-run screen — when the load errored", () => {
    q = { isFetched: true, isError: true };
    render(<TimesheetsPanel />);
    expect(screen.queryByText("No hours logged yet")).toBeNull();
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  // THE REGRESSION THE COUNT QUERY EXISTS FOR.
  // The gate used to count the rows the panel had loaded. Those rows are one week, so paging back
  // to a week nobody worked — a holiday, a shop that started last month — told an established shop
  // it had never logged an hour and offered to set the clock up. That reads as data loss.
  it("does not offer set-up for a quiet week when the shop has hours in other weeks", () => {
    everTotal = 412; // months of history in the database…
    storeState = store([], [{ id: "t1", name: "Mike" }]); // …and nothing in the week on screen
    render(<TimesheetsPanel />);
    expect(screen.queryByText("No hours logged yet")).toBeNull();
    expect(screen.queryByRole("button", { name: "Set up crew" })).toBeNull();
  });
});
