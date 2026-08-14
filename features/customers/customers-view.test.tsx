// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { Lead } from "@/lib/store/types";

// --- injectable test state ---
// The view no longer reads the lead collection from the store — it queries the server a page at a
// time — so the fixture is the QUERY's shape, not the store's.
let leads: Lead[] = [];
let bookTotalOverride: number | undefined;
let custSeg = "people";
// total defaults to the fixture's row count — the view gates first-run on the SERVER total,
// so a fixture with rows but total 0 would render the first-run screen and prove nothing.
let listState = { total: undefined as number | undefined, isFetched: true, isError: false, isLoading: false, isRefetching: false };
const openModal = vi.fn();
const clearFilters = vi.fn();
// The list's own filter state, settable per test — the view decides which parts of it reach the
// query, and that decision is what the archived-set tests assert.
let queryState = { search: "", stage: "", source: "", scope: "", group: "" };
// The arguments the view actually handed the query on the last render.
let lastQuery: Record<string, unknown> | undefined;

vi.mock("@/lib/store/app-store", () => ({
  useAppStore: (sel: (s: { restoreLead: () => void }) => unknown) => sel({ restoreLead: vi.fn() }),
  useLeads: () => leads,
  useEstimates: () => [],
  useOpenModal: () => openModal,
  useCustSeg: () => custSeg,
  useSetCustSeg: () => vi.fn(),
}));

vi.mock("./use-customers-query", () => ({
  useCustomersQuery: (state: Record<string, unknown>) => ((lastQuery = state), {
    rows: leads,
    shown: leads.length,
    ...listState,
    total: listState.total ?? leads.length,
    // Independently settable: bookTotal is its OWN query on the real hook, so a test must be able
    // to hold it at a stale 0 while rows are on screen (the fresh-signup bug).
    bookTotal: bookTotalOverride ?? listState.total ?? leads.length,
    isStale: false,
    stageCounts: {},
    sources: [],
    hasMore: false,
    loadMore: vi.fn(),
    isLoadingMore: false,
    refetch: vi.fn(),
  }),
  useCustomersQueryState: () => ({
    ...queryState,
    setSearch: vi.fn(), setStage: vi.fn(), setSource: vi.fn(), setScope: vi.fn(), setGroup: vi.fn(),
    sortCol: null, sortDir: null, toggleSortCol: vi.fn(), clear: clearFilters,
  }),
  CUSTOMER_COL_TO_SORT: { name: "name", latest: "lastActivity", age: "created" },
}));
// The DTO -> store mapper has its own coverage; here the fixture rows are already store shaped.
vi.mock("./leads-hydrator", () => ({ toStoreLead: (l: unknown) => l }));

// Stub heavy children so the view renders in isolation (mirrors the branding-card test approach).
// The toolbar owns the Active/Archived toggle, so the stub has to be able to flip it — the
// archived-set behaviour is unreachable otherwise.
vi.mock("./customers-toolbar", () => ({
  CustomersToolbar: ({ onArchiveSet }: { onArchiveSet: (v: "active" | "archived") => void }) => (
    <div data-testid="toolbar">
      <button onClick={() => onArchiveSet("archived")}>Show archived</button>
    </div>
  ),
}));
vi.mock("./companies-view", () => ({ CompaniesView: () => <div data-testid="companies" /> }));
vi.mock("./lead-row", () => ({ LeadRow: () => (<tr data-testid="lead-row"><td /></tr>) }));
vi.mock("./customers-columns", () => ({
  CustomersColumns: () => <div />,
  ALL_COL_DEFS: { name: { l: "Name", w: 22 } },
  DEFAULT_COLS: ["name"],
  colWidths: (cols: readonly string[]) => cols.map(() => `${100 / cols.length}%`),
}));
vi.mock("./customers-group-filter", () => ({ CustomersGroupFilter: () => <div data-testid="groups" /> }));
// The chips read their counts from the server — one query, mocked flat so the view can render.
vi.mock("@/lib/trpc/client", () => ({
  api: { v1: { customers: { groupCounts: { useQuery: () => ({ data: undefined }) } } } },
}));
vi.mock("@/components/shared/view-toggle", () => ({ ViewToggle: () => <div /> }));
vi.mock("@/features/pipeline/pipeline-constants", () => ({ isStaleLead: () => false }));

import { CustomersView } from "./customers-view";

const aLead = (): Lead =>
  ({ id: "1", name: "Ann", phone: "", source: "", stage: "New customer", age: 0, job: "", last: "",
     unread: 0, value: 0, acts: [], archived: false } as unknown as Lead);

describe("CustomersView — first-run empty state", () => {
  beforeEach(() => {
    leads = [];
    custSeg = "people";
    bookTotalOverride = undefined;
    // A full reset, not a spread of the previous value — spreading leaked isLoading and total
    // from one test into the next.
    listState = { total: undefined, isFetched: true, isError: false, isLoading: false, isRefetching: false };
    vi.clearAllMocks();
  });

  it("shows the first-run screen (and hides the list chrome) when loaded and empty", () => {
    render(<CustomersView />);
    expect(screen.getByText("No customers yet")).toBeTruthy();
    expect(screen.getByRole("button", { name: "+ Add a customer" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Upload a CSV" })).toBeTruthy();
    expect(screen.queryByTestId("toolbar")).toBeNull();
  });

  it("shows the list, not the first-run screen, once a customer exists", () => {
    leads = [aLead()];
    render(<CustomersView />);
    expect(screen.queryByText("No customers yet")).toBeNull();
    expect(screen.getByTestId("toolbar")).toBeTruthy();
  });

  it("shows the list when rows are loaded even if the book count is still a stale 0", () => {
    // The fresh-signup bug: a brand-new shop adds its first customer, the rows arrive, but
    // bookTotal — its own unfiltered count query — has not refetched yet. First-run short-circuits
    // the table, so the screen stayed on "No customers yet" until a manual page refresh. Rows on
    // screen are proof the shop is not empty, whatever the count currently says.
    leads = [aLead()];
    bookTotalOverride = 0;
    render(<CustomersView />);
    expect(screen.queryByText("No customers yet")).toBeNull();
    expect(screen.getByTestId("toolbar")).toBeTruthy();
    expect(screen.getByTestId("lead-row")).toBeTruthy();
  });

  it("shows the quiet loading state on cold load — not the first-run flash, not the list chrome", () => {
    // Cold load: the first page is in flight and nothing has arrived. A shop that HAS customers
    // must not see "No customers yet" for ~1s on reload, and the toolbar should not render over an
    // empty table either. isLoading is now the signal — the query owns it, not the store.
    listState = { ...listState, isFetched: false, isError: false, isLoading: true, total: undefined };
    render(<CustomersView />);
    expect(screen.queryByText("No customers yet")).toBeNull();
    expect(screen.queryByTestId("toolbar")).toBeNull();
    expect(screen.getByText("Loading…")).toBeTruthy();
  });

  it("shows the load-failed state — not the first-run screen — when the load errored", () => {
    // A failed load is not "no customers". Previously this rendered the toolbar over an
    // empty table, which read to a shop with 400 customers as though they had none.
    listState = { ...listState, isFetched: true, isError: true };
    render(<CustomersView />);
    expect(screen.queryByText("No customers yet")).toBeNull();
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText(/Couldn.t load your customers/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("keeps showing cached rows when a refetch fails (stale data beats an error screen)", () => {
    leads = [aLead()];
    listState = { ...listState, isFetched: true, isError: true };
    render(<CustomersView />);
    expect(screen.queryByText(/Couldn.t load your customers/)).toBeNull();
    expect(screen.getByTestId("toolbar")).toBeTruthy();
  });

  it("the header Import action opens the CSV import modal (moved from Settings)", () => {
    leads = [aLead()]; // populated view — the header button, not the first-run path
    render(<CustomersView />);
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(openModal).toHaveBeenCalledWith("import-customers");
  });

  it("wires the two paths to the New-customer and Import-customers modals", () => {
    render(<CustomersView />);
    fireEvent.click(screen.getByRole("button", { name: "+ Add a customer" }));
    fireEvent.click(screen.getByRole("button", { name: "Upload a CSV" }));
    expect(openModal).toHaveBeenCalledWith("new-customer");
    expect(openModal).toHaveBeenCalledWith("import-customers");
  });
});

/**
 * THE ARCHIVED SET AND THE GROUP CHIPS ARE DIFFERENT AXES.
 *
 * Every arm of leadGroupCondition ANDs `deleted_at IS NULL` — a group describes where a LIVE
 * customer's work has got to. Sent alongside `archived: true` it asks for a row that is both
 * deleted and not, so the archived list came back empty for every shop with a chip selected, said
 * "No archived customers" as though that settled it, and disabled the chips so there was no way to
 * take the selection off.
 */
describe("CustomersView — the archived set", () => {
  beforeEach(() => {
    leads = [];
    custSeg = "people";
    bookTotalOverride = 12;
    listState = { total: 12, isFetched: true, isError: false, isLoading: false, isRefetching: false };
    queryState = { search: "", stage: "", source: "", scope: "", group: "" };
    lastQuery = undefined;
    vi.clearAllMocks();
  });

  it("drops the group selection when the archived set is showing", () => {
    queryState = { ...queryState, group: "owesMoney" };
    leads = [aLead()];
    render(<CustomersView />);
    fireEvent.click(screen.getByRole("button", { name: "Show archived" }));
    expect(lastQuery?.archived).toBe(true);
    expect(lastQuery?.group).toBe("");
  });

  it("still narrows the live set by the group selection", () => {
    queryState = { ...queryState, group: "owesMoney" };
    leads = [aLead()];
    render(<CustomersView />);
    expect(lastQuery?.archived).toBe(false);
    expect(lastQuery?.group).toBe("owesMoney");
  });

  it("states the archived set is empty only when nothing is narrowing it", () => {
    render(<CustomersView />);
    fireEvent.click(screen.getByRole("button", { name: "Show archived" }));
    expect(screen.getByText("No archived customers.")).toBeTruthy();
  });

  it("offers a way out instead of asserting emptiness when a search is narrowing the archived set", () => {
    queryState = { ...queryState, search: "abbott" };
    render(<CustomersView />);
    fireEvent.click(screen.getByRole("button", { name: "Show archived" }));
    expect(screen.queryByText("No archived customers.")).toBeNull();
    const clear = screen.getByRole("button", { name: "clear the filters" });
    fireEvent.click(clear);
    expect(clearFilters).toHaveBeenCalled();
  });
});

describe("CustomersView — the Companies segment", () => {
  beforeEach(() => {
    leads = [];
    custSeg = "people";
    queryState = { search: "", stage: "", source: "", scope: "", group: "" };
    listState = { total: undefined, isFetched: true, isError: false, isLoading: false, isRefetching: false };
  });

  it("renders the companies book when the Companies segment is selected", () => {
    // The button survived a filter refactor that dropped the branch it switched to, so clicking
    // Companies just highlighted the segment and left you on the People list.
    custSeg = "biz";
    render(<CustomersView />);
    expect(screen.getByTestId("companies")).toBeTruthy();
  });

  it("renders the people list on the People segment", () => {
    custSeg = "people";
    render(<CustomersView />);
    expect(screen.queryByTestId("companies")).toBeNull();
  });
});
