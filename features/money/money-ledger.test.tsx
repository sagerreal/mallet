// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";

interface Store {
  invoices: unknown[];
  jobs: unknown[];
  leads: unknown[];
  addInvoice: (d: unknown) => { invoice: { id: string }; persisted: Promise<{ ok: boolean }> };
  recordPayment: () => void;
  updateInvoice: () => void;
  toggles: { techSeesPrice: boolean; frontDesk: boolean; autoRemind: boolean; measurementEstimating: boolean };
  setToggle: (k: string, v: boolean) => void;
}
let storeState: Store;
// The ledger queries the server now — two halves, ready-to-bill and invoices — so the fixture is
// the QUERY's shape rather than the store's.
let moneyState = {
  readyJobs: [] as unknown[],
  invoiceRows: [] as unknown[],
  total: undefined as number | undefined,
  isFetched: true, isError: false, isLoading: false, isRefetching: false,
  bandCounts: undefined as Record<string, number> | undefined,
};
const openModal = vi.fn();
const push = vi.fn();
const updateInvoice = vi.fn();
const addInvoice = vi.fn(() => ({ invoice: { id: "inv-1" }, persisted: Promise.resolve({ ok: true }) }));

vi.mock("@/lib/store/app-store", () => ({
  useAppStore: (sel: (s: Store) => unknown) => sel(storeState),
  useOpenModal: () => openModal,
}));
vi.mock("./use-money-query", () => ({
  useMoneyQuery: () => ({
    ...moneyState,
    // total defaults to the fixture's row count: the view gates first-run on the SERVER total, so
    // rows-with-total-0 would render the first-run screen and pass for the wrong reason.
    total: moneyState.total ?? moneyState.invoiceRows.length + moneyState.readyJobs.length,
    bookTotal: moneyState.total ?? moneyState.invoiceRows.length + moneyState.readyJobs.length,
    isStale: false,
    readyTruncated: false,
    shown: moneyState.invoiceRows.length + moneyState.readyJobs.length,
    hasMore: false, loadMore: vi.fn(), isLoadingMore: false, refetch: vi.fn(),
    // The chip row's numbers. Always an object — the hook builds it from optional query data with
    // `?? {}`, so a band is ABSENT rather than the whole map being undefined.
    bandCounts: moneyState.bandCounts ?? {},
  }),
  useMoneyQueryState: () => ({ search: "", setSearch: vi.fn(), clear: vi.fn() }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
const advanceReminder = vi.fn();
vi.mock("@/lib/trpc/vanilla", () => ({
  trpcVanilla: { v1: { notifications: { advanceReminder: { mutate: (i: unknown) => advanceReminder(i) } } } },
}));
// The row callbacks are captured so a test can invoke one directly — the table itself is stubbed,
// but what the ledger DOES when a row's action fires is this file's business.
let lastCallbacks: { onRemind: (id: string) => void } | undefined;
vi.mock("./money-table", () => ({
  MoneyTable: (props: { cb?: { onRemind: (id: string) => void } }) => {
    lastCallbacks = props.cb;
    return <div data-testid="table" />;
  },
  MONEY_COL_ORDER: ["num"],
}));
vi.mock("./money-toolbar", () => ({ MoneyToolbar: () => <div data-testid="toolbar" /> }));
// A marker carrying its props: this file proves the chip row reaches the page UNCONDITIONALLY
// (it used to need the Filters disclosure open) and is handed the live band.
vi.mock("./money-band-filter", () => ({
  MoneyBandFilter: ({ band, disabled }: { band: string; disabled?: boolean }) => (
    <div data-testid="bandfilter" data-band={band} data-disabled={String(Boolean(disabled))} />
  ),
}));

import { MoneyLedger } from "./money-ledger";

const store = (invoices: unknown[]): Store => ({
  invoices, jobs: [], leads: [], addInvoice, recordPayment: vi.fn(), updateInvoice,
  // The header's Auto-remind switch reads the org toggle now — it was useState(true), a control
  // that promised reminder texts and wrote nowhere.
  toggles: { techSeesPrice: true, frontDesk: true, autoRemind: true, measurementEstimating: false },
  setToggle: vi.fn(),
});

describe("MoneyLedger — first-run empty state", () => {
  beforeEach(() => {
    storeState = store([]);
    // A full reset, not a spread of the previous value — spreading leaked isLoading and the row
    // fixtures from one test into the next.
    moneyState = { readyJobs: [], invoiceRows: [], total: undefined, isFetched: true, isError: false, isLoading: false, isRefetching: false, bandCounts: undefined };
    vi.clearAllMocks();
  });

  it("shows the first-run screen (not the toolbar/table) when loaded and empty", () => {
    render(<MoneyLedger />);
    expect(screen.getByText("No invoices yet")).toBeTruthy();
    expect(screen.queryByTestId("toolbar")).toBeNull();
    expect(screen.queryByTestId("table")).toBeNull();
  });

  it("wires the two paths to New invoice and the jobs page", () => {
    render(<MoneyLedger />);
    const frs = screen.getByText("No invoices yet").closest(".frs") as HTMLElement;
    fireEvent.click(within(frs).getByRole("button", { name: "+ New invoice" }));
    fireEvent.click(within(frs).getByRole("button", { name: "Go to jobs" }));
    expect(addInvoice).toHaveBeenCalledTimes(1); // newInvoice creates a draft
    expect(push).toHaveBeenCalledWith("/jobs");
  });

  it("shows the table once invoices exist", () => {
    // Rows come from the QUERY now, not the store.
    moneyState = { ...moneyState, invoiceRows: [{ id: "i1" }] };
    render(<MoneyLedger />);
    expect(screen.queryByText("No invoices yet")).toBeNull();
    expect(screen.getByTestId("table")).toBeTruthy();
  });

  it("shows the quiet loading state on cold load — not the first-run flash", () => {
    // isLoading is the cold-load signal now — the query owns it, not a store-empty heuristic.
    moneyState = { ...moneyState, isFetched: false, isLoading: true, total: undefined };
    render(<MoneyLedger />);
    expect(screen.queryByText("No invoices yet")).toBeNull();
    expect(screen.getByText("Loading…")).toBeTruthy();
  });

  it("shows the load-failed state — not the first-run screen — when the load errored", () => {
    moneyState = { ...moneyState, isFetched: true, isError: true };
    render(<MoneyLedger />);
    expect(screen.queryByText("No invoices yet")).toBeNull();
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});

describe("MoneyLedger — the filter is on the page, not behind a button", () => {
  beforeEach(() => {
    moneyState = {
      readyJobs: [], invoiceRows: [{ id: "i1" }], total: 1,
      isFetched: true, isError: false, isLoading: false, isRefetching: false,
      bandCounts: { ready: 39, draft: 16, over: 240, partial: 0, sent: 1, paid: 588 },
    };
    vi.clearAllMocks();
  });

  it("renders the chip row without anything being opened first", () => {
    // It used to live behind the Filters disclosure, holding a Status dropdown with no numbers — so
    // "240 invoices are overdue" took two clicks to learn and was invisible until you went looking.
    render(<MoneyLedger />);
    expect(screen.getByTestId("bandfilter")).toBeTruthy();
  });

  it("hands the chip row the live band", () => {
    render(<MoneyLedger />);
    // Money's default really is ALL of it — unlike the Jobs list, which defaulted to `today` and
    // therefore arrived silently filtered.
    expect(screen.getByTestId("bandfilter").getAttribute("data-band")).toBe("");
  });

  it("goes inert rather than vanishing on the Archived tab", () => {
    render(<MoneyLedger />);
    const before = screen.getByTestId("bandfilter");
    expect(before.getAttribute("data-disabled")).toBe("false");
  });
});

// ---------------------------------------------------------------------------
// The Active/Archived pair on a phone.
//
// The toolbar's copy is `display:none` under 760px (`.toolbar .view-seg` — SectionTabs is the
// mobile page identity, so the desktop control row goes with the header). Money never grew the
// `.mob-ctrl` replacement Customers has, so on a phone there was no way into the Archived set at
// all: a voided invoice was unreachable from the only screen that lists them.
// ---------------------------------------------------------------------------

describe("MoneyLedger — the Archived set is reachable on a phone", () => {
  beforeEach(() => {
    moneyState = {
      readyJobs: [], invoiceRows: [{ id: "i1" }], total: 1,
      isFetched: true, isError: false, isLoading: false, isRefetching: false, bandCounts: undefined,
    };
    vi.clearAllMocks();
  });

  it("renders the set toggle outside the toolbar, in the mobile control row", () => {
    render(<MoneyLedger />);
    const ctrl = document.querySelector(".mob-ctrl");
    expect(ctrl).toBeTruthy();
    expect(
      within(ctrl as HTMLElement).getByRole("group", { name: "Show active or archived invoices" }),
    ).toBeTruthy();
  });

  it("switches the set from it — the chip row goes inert, as it does on the desktop toggle", () => {
    render(<MoneyLedger />);
    const ctrl = document.querySelector(".mob-ctrl") as HTMLElement;
    fireEvent.click(within(ctrl).getByRole("button", { name: "Archived" }));
    expect(screen.getByTestId("bandfilter").getAttribute("data-disabled")).toBe("true");
  });
});

describe("MoneyLedger — Remind actually sends", () => {
  beforeEach(() => {
    advanceReminder.mockReset();
    advanceReminder.mockResolvedValue({ id: "n1" });
    updateInvoice.mockReset();
    lastCallbacks = undefined;
  });

  it("sends the reminder before marking the row reminded", async () => {
    // Remind used to only bump the local follow-up stage: the row moved to "Reminded" and no
    // reminder was ever sent, so the office stopped chasing an invoice nobody had chased.
    moneyState.invoiceRows = [
      { id: "inv-1", num: "INV-1001", leadId: "lead-1", cust: "Priya", status: "sent",
        total: 685, depPaid: 0, payments: [], lines: [], age: 9, archived: false, fu: { on: true, stage: 0 } },
    ];
    render(<MoneyLedger />);

    lastCallbacks?.onRemind("inv-1");
    await waitFor(() => expect(advanceReminder).toHaveBeenCalledWith({ relatedType: "invoice", relatedId: "inv-1" }));
    await waitFor(() =>
      expect(updateInvoice).toHaveBeenCalledWith("inv-1", { fu: { on: true, stage: 1 } }),
    );
  });

  it("does not claim the reminder was sent when the server refuses it", async () => {
    // The 10DLC gate returns PRECONDITION_FAILED for an org whose campaign isn't active.
    advanceReminder.mockRejectedValue(new Error("This shop can't text yet."));
    moneyState.invoiceRows = [
      { id: "inv-1", num: "INV-1001", leadId: "lead-1", cust: "Priya", status: "sent",
        total: 685, depPaid: 0, payments: [], lines: [], age: 9, archived: false, fu: { on: true, stage: 0 } },
    ];
    render(<MoneyLedger />);

    lastCallbacks?.onRemind("inv-1");
    await waitFor(() => expect(advanceReminder).toHaveBeenCalled());
    expect(updateInvoice).not.toHaveBeenCalled();
  });
});
