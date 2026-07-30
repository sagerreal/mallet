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
let q = { isFetched: true, isError: false };
const openModal = vi.fn();
const push = vi.fn();
const addInvoice = vi.fn(() => ({ id: "inv-1" }));

vi.mock("@/lib/store/app-store", () => ({
  useAppStore: (sel: (s: Store) => unknown) => sel(storeState),
  useOpenModal: () => openModal,
}));
// jobs.list rides along since the ledger now also gates on the jobs hydrator (ready-to-bill rows).
vi.mock("@/lib/trpc/client", () => ({ api: { v1: { invoicing: { list: { useQuery: () => q } }, jobs: { list: { useQuery: () => q } } } } }));
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
  beforeEach(() => { storeState = store([]); q = { isFetched: true, isError: false }; vi.clearAllMocks(); });

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
    storeState = store([{ id: "i1" }]);
    render(<MoneyLedger />);
    expect(screen.queryByText("No invoices yet")).toBeNull();
    expect(screen.getByTestId("table")).toBeTruthy();
  });

  it("shows the quiet loading state on cold load — not the first-run flash", () => {
    q = { isFetched: false, isError: false };
    render(<MoneyLedger />);
    expect(screen.queryByText("No invoices yet")).toBeNull();
    expect(screen.getByText("Loading…")).toBeTruthy();
  });

  it("shows the load-failed state — not the first-run screen — when the load errored", () => {
    q = { isFetched: true, isError: true };
    render(<MoneyLedger />);
    expect(screen.queryByText("No invoices yet")).toBeNull();
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});
