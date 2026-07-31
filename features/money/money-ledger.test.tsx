// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

interface Store {
  invoices: unknown[];
  jobs: unknown[];
  leads: unknown[];
  addInvoice: (d: unknown) => { id: string };
  recordPayment: () => void;
  updateInvoice: () => void;
}
let storeState: Store;
// The ledger queries the server now — two halves, ready-to-bill and invoices — so the fixture is
// the QUERY's shape rather than the store's.
let moneyState = {
  readyJobs: [] as unknown[],
  invoiceRows: [] as unknown[],
  total: undefined as number | undefined,
  isFetched: true, isError: false, isLoading: false, isRefetching: false,
};
const openModal = vi.fn();
const push = vi.fn();
const addInvoice = vi.fn(() => ({ id: "inv-1" }));

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
    readyTruncated: false,
    shown: moneyState.invoiceRows.length + moneyState.readyJobs.length,
    hasMore: false, loadMore: vi.fn(), isLoadingMore: false, refetch: vi.fn(),
  }),
  useMoneyQueryState: () => ({ search: "", setSearch: vi.fn(), clear: vi.fn() }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("./money-table", () => ({ MoneyTable: () => <div data-testid="table" />, MONEY_COL_ORDER: ["num"] }));
vi.mock("./money-toolbar", () => ({
  MoneyToolbar: () => <div data-testid="toolbar" />,
  MoneyColumnsPanel: () => <div />,
  MoneyFiltersPanel: () => <div />,
}));

import { MoneyLedger } from "./money-ledger";

const store = (invoices: unknown[]): Store => ({
  invoices, jobs: [], leads: [], addInvoice, recordPayment: vi.fn(), updateInvoice: vi.fn(),
});

describe("MoneyLedger — first-run empty state", () => {
  beforeEach(() => {
    storeState = store([]);
    // A full reset, not a spread of the previous value — spreading leaked isLoading and the row
    // fixtures from one test into the next.
    moneyState = { readyJobs: [], invoiceRows: [], total: undefined, isFetched: true, isError: false, isLoading: false, isRefetching: false };
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
