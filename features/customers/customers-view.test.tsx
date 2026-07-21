// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { Lead } from "@/lib/store/types";

// --- injectable test state ---
let leads: Lead[] = [];
let custSeg = "people";
let queryState = { isFetched: true, isError: false };
const openModal = vi.fn();

vi.mock("@/lib/store/app-store", () => ({
  useAppStore: (sel: (s: { restoreLead: () => void }) => unknown) => sel({ restoreLead: vi.fn() }),
  useLeads: () => leads,
  useEstimates: () => [],
  useOpenModal: () => openModal,
  useCustSeg: () => custSeg,
  useSetCustSeg: () => vi.fn(),
}));

// api.v1.customers.list.useQuery — dedupes the hydrator's query; we only read {isFetched,isError}.
vi.mock("@/lib/trpc/client", () => ({
  api: { v1: { customers: { list: { useQuery: () => queryState } } } },
}));

// Stub heavy children so the view renders in isolation (mirrors the branding-card test approach).
vi.mock("./customers-toolbar", () => ({ CustomersToolbar: () => <div data-testid="toolbar" /> }));
vi.mock("./companies-view", () => ({ CompaniesView: () => <div data-testid="companies" /> }));
vi.mock("./lead-row", () => ({ LeadRow: () => (<tr data-testid="lead-row"><td /></tr>) }));
vi.mock("./customers-columns", () => ({
  CustomersColumns: () => <div />,
  ALL_COL_DEFS: { name: { l: "Name" } },
  DEFAULT_COLS: ["name"],
}));
vi.mock("./customers-filters", () => ({ CustomersFilters: () => <div /> }));
vi.mock("@/components/shared/view-toggle", () => ({ ViewToggle: () => <div /> }));
vi.mock("@/features/pipeline/pipeline-constants", () => ({ isStaleLead: () => false }));

import { CustomersView } from "./customers-view";

const aLead = (): Lead =>
  ({ id: "1", name: "Ann", phone: "", source: "", stage: "New customer", age: 0, job: "", last: "",
     unread: 0, value: 0, acts: [], evisits: [], archived: false } as unknown as Lead);

describe("CustomersView — first-run empty state", () => {
  beforeEach(() => {
    leads = [];
    custSeg = "people";
    queryState = { isFetched: true, isError: false };
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

  it("shows the quiet loading state on cold load — not the first-run flash, not the list chrome", () => {
    // isFirstLoad window: the hydrator's first fetch is in flight and the store is
    // empty. A shop that HAS customers must not see "No customers yet" for ~1s on
    // reload, and the toolbar shouldn't render over an empty table either.
    queryState = { isFetched: false, isError: false };
    render(<CustomersView />);
    expect(screen.queryByText("No customers yet")).toBeNull();
    expect(screen.queryByTestId("toolbar")).toBeNull();
    expect(screen.getByText("Loading…")).toBeTruthy();
  });

  it("shows the load-failed state — not the first-run screen — when the load errored", () => {
    // A failed load is not "no customers". Previously this rendered the toolbar over an
    // empty table, which read to a shop with 400 customers as though they had none.
    queryState = { isFetched: true, isError: true };
    render(<CustomersView />);
    expect(screen.queryByText("No customers yet")).toBeNull();
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText(/Couldn.t load your customers/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("keeps showing cached rows when a refetch fails (stale data beats an error screen)", () => {
    leads = [aLead()];
    queryState = { isFetched: true, isError: true };
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
