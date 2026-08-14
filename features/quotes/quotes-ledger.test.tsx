// @vitest-environment jsdom
/**
 * The quotes ledger page: the four list states, the chips, the search, the one figure, and where
 * a row goes (the existing quote sheet — this page opens records, it never edits them).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { QuotesLedger } from "./quotes-ledger";
import type { Estimate, Lead } from "@/lib/store/types";

let mockEstimates: Estimate[] = [];
let mockLeads: Lead[] = [];
let mockQuery = { isFetched: true, isError: false, isRefetching: false, refetch: vi.fn() };
const openModal = vi.fn();
const routerPush = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: routerPush }) }));
vi.mock("@/lib/store/app-store", () => ({
  useAppStore: (sel: (s: { estimates: Estimate[]; leads: Lead[] }) => unknown) =>
    sel({ estimates: mockEstimates, leads: mockLeads }),
  useOpenModal: () => openModal,
}));
vi.mock("@/lib/trpc/client", () => ({
  api: { v1: { quoting: { list: { useQuery: () => mockQuery } } } },
}));

const est = (over: Partial<Estimate> = {}): Estimate =>
  ({
    id: "e1",
    leadId: "l1",
    title: "Water heater swap",
    status: "sent",
    age: 2,
    cachedTotal: 2450,
    lines: [],
    ...over,
  }) as unknown as Estimate;

beforeEach(() => {
  mockEstimates = [
    est(),
    est({ id: "e2", title: "Repipe, whole house", status: "draft", age: 0, cachedTotal: 11800 }),
    est({ id: "e3", title: "Tankless conversion", status: "accepted", age: 5, cachedTotal: 4980 }),
  ];
  mockLeads = [{ id: "l1", name: "Dana Alvarez" }] as unknown as Lead[];
  mockQuery = { isFetched: true, isError: false, isRefetching: false, refetch: vi.fn() };
  openModal.mockClear();
  routerPush.mockClear();
});

describe("QuotesLedger — the populated book", () => {
  it("renders the rows with the trade's words and the out-the-door figure", () => {
    const { container } = render(<QuotesLedger />);
    // Pills, read from the TABLE (the filter chips share the words).
    const pills = Array.from(container.querySelectorAll("tbody .pill")).map((n) => n.textContent);
    expect(pills).toEqual(["Draft", "Sent", "Won"]); // newest first
    // One SENT quote → its total is the figure.
    expect(screen.getByText(/\$2,450 out/)).toBeTruthy();
    expect(screen.getByText(/3 of 3/)).toBeTruthy();
  });

  it("chips filter the book", () => {
    render(<QuotesLedger />);
    // Scoped to the chips — the rows are pressable and would answer to the same word.
    const chips = screen.getByRole("group", { name: "Filter quotes" });
    fireEvent.click(within(chips).getByRole("button", { name: /^Draft/ }));
    expect(screen.getByText("Repipe, whole house")).toBeTruthy();
    expect(screen.queryByText("Tankless conversion")).toBeNull();
    expect(screen.getByText(/1 of 3/)).toBeTruthy();
  });

  // `.on` is the list-FILTER selected class (ink fill, same band as the Active/Archived
  // control); `.sel` is the in-form chosen-option class. This row filters a list, and the
  // Changes-asked chip beside it already writes `.on` — one row, one selected look.
  it("marks the active filter chip with the list-filter selected class", () => {
    render(<QuotesLedger />);
    const chips = screen.getByRole("group", { name: "Filter quotes" });
    const draft = within(chips).getByRole("button", { name: /^Draft/ });
    fireEvent.click(draft);
    expect(draft.className.split(" ")).toContain("on");
    expect(draft.className.split(" ")).not.toContain("sel");
    // Only the active one carries it.
    expect(within(chips).getByRole("button", { name: /^All/ }).className.split(" ")).not.toContain("on");
  });

  it("search reaches customer and title", () => {
    render(<QuotesLedger />);
    fireEvent.change(screen.getByLabelText("Search quotes"), { target: { value: "tankless" } });
    expect(screen.getByText("Tankless conversion")).toBeTruthy();
    expect(screen.queryByText("Water heater swap")).toBeNull();
  });

  it("a row opens the existing quote sheet", () => {
    render(<QuotesLedger />);
    fireEvent.click(screen.getByText("Water heater swap"));
    expect(openModal).toHaveBeenCalledWith("est", { estId: "e1" });
  });

  it("+ New quote goes to the composer", () => {
    render(<QuotesLedger />);
    fireEvent.click(screen.getByRole("button", { name: "+ New quote" }));
    expect(routerPush).toHaveBeenCalledWith("/composer");
  });
});

describe("QuotesLedger — the other three list states", () => {
  it("first load in flight → loading, never a false empty", () => {
    mockEstimates = [];
    mockQuery = { ...mockQuery, isFetched: false };
    render(<QuotesLedger />);
    expect(screen.getByText("Loading quotes…")).toBeTruthy();
  });

  it("errored with nothing cached → LoadFailed with a retry", () => {
    mockEstimates = [];
    mockQuery = { ...mockQuery, isError: true };
    render(<QuotesLedger />);
    expect(screen.getByRole("button", { name: /Try again/ })).toBeTruthy();
  });

  it("loaded and genuinely empty → the invitation to act", () => {
    mockEstimates = [];
    render(<QuotesLedger />);
    expect(screen.getByText("No quotes yet.")).toBeTruthy();
    // The page head's action and the first-run path both offer it — either lands the same place.
    fireEvent.click(screen.getAllByRole("button", { name: "+ New quote" })[0]!);
    expect(routerPush).toHaveBeenCalledWith("/composer");
  });
});

// Owen, Aug 11: change requests need an APPARENT home. The chip appears — with its count —
// only when a sent quote carries one; a permanent "(0)" chip would be furniture for a state
// that is usually empty.
describe("QuotesLedger — the Changes-asked chip", () => {
  it("absent while nobody has asked for anything", () => {
    render(<QuotesLedger />);
    const chips = screen.getByRole("group", { name: "Filter quotes" });
    expect(within(chips).queryByRole("button", { name: /Changes asked/ })).toBeNull();
  });

  it("appears with its count and filters the book to the asks", () => {
    mockEstimates = [
      est(),
      est({ id: "e9", title: "Sewer line spot repair", changeRequestedAt: "2026-08-11T09:00:00Z" }),
    ];
    render(<QuotesLedger />);
    const chips = screen.getByRole("group", { name: "Filter quotes" });
    // Accessible-name computation collapses the count span's leading space — match the
    // label, read the count from the text.
    const chip = within(chips).getByRole("button", { name: /^Changes asked/ });
    expect(chip.textContent).toContain("(1)");
    fireEvent.click(chip);

    expect(screen.getByText("Sewer line spot repair")).toBeTruthy();
    expect(screen.queryByText("Water heater swap")).toBeNull();
  });
});
