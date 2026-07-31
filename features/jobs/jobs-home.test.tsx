// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

// The screen no longer reads the job collection from the store — it queries the server a page at
// a time — so the fixture is the QUERY's shape, not the store's.
interface ListState {
  rows: unknown[];
  total: number | undefined;
  isFetched: boolean;
  isError: boolean;
  isLoading: boolean;
}
let listState: ListState;
const push = vi.fn();

vi.mock("@/lib/store/app-store", () => ({ useAppStore: () => [] }));
vi.mock("./use-jobs-query", () => ({
  useJobsQuery: () => ({
    ...listState,
    shown: listState.rows.length,
    counts: { counts: {}, todayCents: 0 },
    hasMore: false,
    loadMore: vi.fn(),
    isLoadingMore: false,
    refetch: vi.fn(),
    isRefetching: false,
  }),
  useJobsQueryState: () => ({
    view: null, setView: vi.fn(), search: "", setSearch: vi.fn(),
    sort: null, sortDir: null, toggleSort: vi.fn(), clear: vi.fn(),
  }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/features/jobs/hooks", () => ({ useCallbackCandidates: () => ({ data: [] }) }));
vi.mock("@/features/home/use-animated-number", () => ({ useAnimatedNumber: (n: number) => n }));
vi.mock("./use-jobs-sort", () => ({ useJobsSort: () => ({ sort: { col: "when", dir: "asc" }, setSort: vi.fn() }) }));
vi.mock("./jobs-list-view", () => ({ JobsListView: () => <div data-testid="list" /> }));
vi.mock("./callback-autopsy-card", () => ({ CallbackAutopsyCard: () => null }));
vi.mock("./jobs-toolbar", () => ({ JobsToolbar: () => <div data-testid="toolbar" /> }));
vi.mock("./jobs-view-filter", () => ({ JobsViewFilter: () => <div /> }));
// The row adapter has its own tests; here the fixture rows are bare ids, so it is stubbed to keep
// this file about the screen's BRANCHING (first run / loading / failed / list) and nothing else.
vi.mock("./server-rows", () => ({
  serverRowsToBands: (rows: unknown[]) => ({ bands: rows.length ? [{ key: "today", jobs: rows }] : [], jobs: rows }),
  SORT_COL_TO_SERVER: { when: "scheduled", amount: "amount", customer: null },
}));
vi.mock("./jobs-columns", () => ({ JobsColumns: () => <div /> }));

import { JobsHome } from "./jobs-home";

const list = (rows: unknown[], over: Partial<ListState> = {}): ListState => ({
  rows, total: rows.length, bookTotal: rows.length, isStale: false, isFetched: true, isError: false, isLoading: false, ...over,
});
const setup = () => {
  const onOpenNewJob = vi.fn();
  render(<JobsHome onOpenJob={vi.fn()} onOpenNewJob={onOpenNewJob} />);
  return { onOpenNewJob };
};

describe("JobsHome — first-run empty state", () => {
  beforeEach(() => { listState = list([]); vi.clearAllMocks(); });

  it("shows the first-run screen (not the toolbar/list) when loaded and empty", () => {
    setup();
    expect(screen.getByText(/Jobs land here when you book one/)).toBeTruthy();
    expect(screen.queryByTestId("toolbar")).toBeNull();
    expect(screen.queryByTestId("list")).toBeNull();
  });

  it("wires the two paths to the New-job modal and the composer", () => {
    const { onOpenNewJob } = setup();
    const frs = screen.getByText(/Jobs land here/).closest(".frs") as HTMLElement;
    fireEvent.click(within(frs).getByRole("button", { name: "+ New job" }));
    fireEvent.click(within(frs).getByRole("button", { name: "+ New quote" }));
    expect(onOpenNewJob).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("/composer");
  });

  it("shows the list chrome once jobs exist", () => {
    listState = list([{ id: "j1" }]);
    setup();
    expect(screen.queryByText(/Jobs land here/)).toBeNull();
    expect(screen.getByTestId("toolbar")).toBeTruthy();
    expect(screen.getByTestId("list")).toBeTruthy();
  });

  it("shows a loading line — not the first-run screen, toolbar, or 'No jobs yet' copy — while first-loading", () => {
    listState = list([], { isFetched: false, isLoading: true, total: undefined });
    setup();
    expect(screen.getByText("Loading…")).toBeTruthy();
    expect(screen.queryByText(/Jobs land here/)).toBeNull(); // not the rich first-run
    expect(screen.queryByText(/create one/)).toBeNull(); // not the compact "No jobs yet — create one" flash
    expect(screen.queryByTestId("toolbar")).toBeNull();
  });

  it("shows the load-failed state — not the first-run screen — when the load errored", () => {
    listState = list([], { isError: true, total: 0 });
    setup();
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(screen.queryByText(/Jobs land here/)).toBeNull();
  });

  it("does not show the loading line once jobs are present, even mid-refetch", () => {
    // Rows already on screen: a refetch must not replace them with a loading line.
    listState = list([{ id: "j1" }], { isFetched: false });
    setup();
    expect(screen.queryByText("Loading…")).toBeNull();
    expect(screen.getByTestId("toolbar")).toBeTruthy();
    expect(screen.getByTestId("list")).toBeTruthy();
  });
});
