// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

// The screen no longer reads the job collection from the store — it queries the server a page at
// a time — so the fixture is the QUERY's shape, not the store's.
interface ListState {
  rows: unknown[];
  total: number | undefined;
  /** The whole book, ignoring filters — what the first-run gate keys on, so a no-match search
   *  falls through to an empty list instead of "No jobs yet". */
  bookTotal: number | undefined;
  /** A page being replaced, or a search typed but not yet debounced. */
  isStale: boolean;
  isFetched: boolean;
  isError: boolean;
  isLoading: boolean;
}
let listState: ListState;
const push = vi.fn();
/** The last argument set the screen asked the server for — the Active tab's filter is in here. */
let lastQueryArgs: Record<string, unknown> = {};
/** The screen's own filter state, so a test can put it on the Archived tab or pick a view. */
let queryState: Record<string, unknown>;

vi.mock("@/lib/store/app-store", () => ({ useAppStore: () => [], useOpenModal: () => vi.fn() }));
vi.mock("./use-jobs-query", () => ({
  useJobsQuery: (args: Record<string, unknown>) => ((lastQueryArgs = args), {
    ...listState,
    shown: listState.rows.length,
    counts: { counts: {}, todayCents: 0 },
    hasMore: false,
    loadMore: vi.fn(),
    isLoadingMore: false,
    refetch: vi.fn(),
    isRefetching: false,
  }),
  useJobsQueryState: () => queryState,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/features/jobs/hooks", () => ({ useCallbackCandidates: () => ({ data: [] }) }));
vi.mock("@/features/home/use-animated-number", () => ({ useAnimatedNumber: (n: number) => n }));
vi.mock("./use-jobs-sort", () => ({ useJobsSort: () => ({ sort: { col: "when", dir: "asc" }, setSort: vi.fn() }) }));
vi.mock("./jobs-list-view", () => ({ JobsListView: () => <div data-testid="list" /> }));
vi.mock("./callback-autopsy-card", () => ({ CallbackAutopsyCard: () => null }));
// The Active/Archived toggle is the real one — it owns the filter this file asserts on.
vi.mock("./jobs-toolbar", () => ({
  JobsToolbar: ({ archiveSet, onArchiveSet }: { archiveSet: string; onArchiveSet: (v: string) => void }) => (
    <div data-testid="toolbar">
      <button onClick={() => onArchiveSet(archiveSet === "active" ? "archived" : "active")}>toggle-set</button>
    </div>
  ),
}));
// Rendered as a marker carrying its props: this file's job is to prove the chip row reaches the
// page UNCONDITIONALLY (it used to need the Filters disclosure open) and gets the live view.
vi.mock("./jobs-view-filter", () => ({
  JobsViewFilter: ({ view, disabled }: { view: string | null; disabled?: boolean }) => (
    <div data-testid="viewfilter" data-view={view ?? ""} data-disabled={String(Boolean(disabled))} />
  ),
}));
// The row adapter has its own tests; here the fixture rows are bare ids, so it is stubbed to keep
// this file about the screen's BRANCHING (first run / loading / failed / list) and nothing else.
vi.mock("./server-rows", () => ({
  serverPageToRows: (rows: unknown[]) => ({ rows: rows.map((job) => ({ job, bandKey: "today" })), jobs: rows }),
  SORT_COL_TO_SERVER: { when: "scheduled", amount: "amount", customer: null },
}));

import { JobsHome } from "./jobs-home";

const list = (rows: unknown[], over: Partial<ListState> = {}): ListState => ({
  rows, total: rows.length, bookTotal: rows.length, isStale: false, isFetched: true, isError: false, isLoading: false, ...over,
});
const setup = () => {
  const onOpenNewJob = vi.fn();
  render(<JobsHome onOpenJob={vi.fn()} onOpenNewJob={onOpenNewJob} />);
  return { onOpenNewJob };
};

const freshQueryState = (over: Record<string, unknown> = {}) => ({
  view: null, setView: vi.fn(), search: "", setSearch: vi.fn(),
  sort: null, sortDir: null, toggleSort: vi.fn(), clear: vi.fn(),
  ...over,
});

describe("JobsHome — first-run empty state", () => {
  beforeEach(() => { listState = list([]); queryState = freshQueryState(); vi.clearAllMocks(); });

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

describe("JobsHome — the Active/Archived toggle actually filters", () => {
  beforeEach(() => { listState = list([{ id: "j1" }]); queryState = freshQueryState(); vi.clearAllMocks(); });

  it("asks for everything-but-archived on the Active tab", () => {
    // "All" used to send activeOnly, which excludes ALL finished work — so the chip read 39 while
    // the seven bands summed to 65, hiding Done (14) and Done-not-billed (12) from the chip that
    // claimed to contain them. The Active/Archived toggle already separates the archive.
    setup();
    expect(lastQueryArgs.excludeArchived).toBe(true);
    expect(lastQueryArgs.view).toBeNull();
  });

  it("drops it on the Archived tab and asks for the archived view", () => {
    setup();
    fireEvent.click(screen.getByText("toggle-set"));
    expect(lastQueryArgs.view).toBe("archived");
    expect(lastQueryArgs.excludeArchived).toBe(false);
  });

  it("does not stack it on a chosen view", () => {
    // Each view is already a precise slice, and two of them are finished work by definition. ANDing
    // "not archived" on top would return zero rows while the chip's count promised some — a dead
    // control. Archived is a view too, so it is covered by the same rule.
    queryState = freshQueryState({ view: "done" });
    setup();
    expect(lastQueryArgs.view).toBe("done");
    expect(lastQueryArgs.excludeArchived).toBe(false);
  });
});

describe("JobsHome — the filter is on the page, not behind a button", () => {
  beforeEach(() => { listState = list([{ id: "j1" }]); queryState = freshQueryState({ view: "today" }); vi.clearAllMocks(); });

  it("renders the chip row without anything being opened first", () => {
    // THE BUG. The row lived behind a Filters disclosure while the list DEFAULTS to view="today",
    // so the screen arrived filtered with nothing on it naming the filter — the only tell was an
    // amber "1" on a collapsed button — and the toolbar read "20 of 20" on a ~1,500-job book.
    setup();
    expect(screen.getByTestId("viewfilter")).toBeTruthy();
  });

  it("hands the chip row the live view, so the default filter is visible", () => {
    setup();
    expect(screen.getByTestId("viewfilter").getAttribute("data-view")).toBe("today");
  });

  it("goes inert rather than vanishing on the Archived tab, so nothing below it jumps", () => {
    setup();
    fireEvent.click(screen.getByText("toggle-set"));
    const f = screen.getByTestId("viewfilter");
    expect(f).toBeTruthy();
    expect(f.getAttribute("data-disabled")).toBe("true");
  });
});
