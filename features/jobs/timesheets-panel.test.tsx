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
}
let storeState: Store;
let q = { isFetched: true, isError: false };
const push = vi.fn();

vi.mock("@/lib/store/app-store", () => ({ useAppStore: (sel: (s: Store) => unknown) => sel(storeState) }));
vi.mock("@/lib/trpc/client", () => ({ api: { v1: { timesheets: { list: { useQuery: () => q } } } } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("./timesheets-crew", () => ({ TsCrewChips: () => <div data-testid="crew" />, TsTechWeekCard: () => <div /> }));

import { TimesheetsPanel } from "./timesheets-panel";

const store = (timeEntries: unknown[], techs: Store["techs"] = []): Store => ({
  techs, jobs: [], leads: [], timeEntries,
  addTimeEntry: vi.fn(), updateTimeEntry: vi.fn(), deleteTimeEntry: vi.fn(), approveTechWeek: vi.fn(), reopenEntry: vi.fn(),
});

describe("TimesheetsPanel — first-run empty state", () => {
  beforeEach(() => { storeState = store([]); q = { isFetched: true, isError: false }; vi.clearAllMocks(); });

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

  it("shows the quiet loading state on cold load — not the first-run flash", () => {
    q = { isFetched: false, isError: false };
    render(<TimesheetsPanel />);
    expect(screen.queryByText("No hours logged yet")).toBeNull();
    expect(screen.getByText("Loading…")).toBeTruthy();
  });
});
