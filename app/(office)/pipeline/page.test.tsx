// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

interface Store {
  estimates: unknown[];
  leads: { id: string; archived: boolean; stage: string }[];
  invoices: unknown[];
  jobs: unknown[];
  techs: unknown[];
  brand: { name: string };
}
let storeState: Store;
let queryState = { isFetched: true, isError: false };
const openModal = vi.fn();
const push = vi.fn();

vi.mock("@/lib/store/app-store", () => ({
  useAppStore: (sel: (s: Store) => unknown) => sel(storeState),
  useOpenModal: () => openModal,
}));
vi.mock("@/lib/trpc/client", () => ({
  // quoting.list rides along since the money strip now gates on the estimates hydrator.
  api: {
    v1: {
      customers: {
        list: { useQuery: () => queryState },
        // The board's column counts come from the database now — a header reading 500 over 500
        // visible cards on a 606-customer book was the lie this replaced.
        viewCounts: { useQuery: () => ({ data: undefined }) },
        // lost (N) comes from the database now — Lost customers are the oldest rows.
        count: { useQuery: () => ({ data: undefined }) },
      },
      quoting: { list: { useQuery: () => queryState } },
    },
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/features/home/use-animated-number", () => ({ useAnimatedNumber: (n: number) => n }));
// Out and Won are fetched for their columns now, not derived from the loaded book — a quote whose
// customer had not loaded used to be dropped from the column with no trace.
let railFetched = true;
vi.mock("@/features/pipeline/use-rail-columns", () => ({
  useRailColumns: () => ({
    getting: [], out: [], won: [], outSum: 0, outCount: 0,
    outTruncated: false, wonTruncated: false, delta: null,
    isFetched: railFetched, isError: false,
  }),
}));
// intakeRowOf shapes one card; the SET is chosen by the server query above.
vi.mock("@/features/pipeline/working", () => ({
  intakeRowOf: (lead: unknown) => ({ lead, stalled: false, stamp: "today" }),
  byStalledThenAge: () => 0,
  deriveGetting: () => [],
}));
vi.mock("@/features/pipeline/board-cards", () => ({
  IntakeCard: () => <div />,
  GettingCard: () => <div />,
  OutCard: () => <div />,
  WonCard: () => <div />,
}));

import PipelinePage from "./page";

const store = (leads: Store["leads"]): Store => ({
  estimates: [], leads, invoices: [], jobs: [], techs: [], brand: { name: "Test" },
});

describe("PipelinePage — first-run empty state", () => {
  beforeEach(() => {
    storeState = store([]);
    queryState = { isFetched: true, isError: false };
    railFetched = true;
    vi.clearAllMocks();
  });

  it("shows the first-run screen (not the board) when loaded and empty", () => {
    render(<PipelinePage />);
    expect(screen.getByText("Your pipeline is empty")).toBeTruthy();
    expect(screen.queryByText("New leads")).toBeNull();
  });

  it("shows the board once leads exist", () => {
    storeState = store([{ id: "1", archived: false, stage: "New customer" }]);
    render(<PipelinePage />);
    expect(screen.queryByText("Your pipeline is empty")).toBeNull();
    expect(screen.getByText("New leads")).toBeTruthy();
  });

  it("shows the quiet loading state on cold load — not the first-run flash", () => {
    queryState = { isFetched: false, isError: false };
    render(<PipelinePage />);
    expect(screen.queryByText("Your pipeline is empty")).toBeNull();
    expect(screen.getByText("Loading…")).toBeTruthy();
  });

  it("holds one skeleton until every column's first fetch lands — columns never pop in", () => {
    storeState = store([{ id: "1", archived: false, stage: "New customer" }]);
    railFetched = false;
    render(<PipelinePage />);
    // The board-shaped skeleton, not a half-populated board.
    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.queryByText("Nothing’s sitting on anyone’s phone.")).toBeNull();
  });

  it("shows the load-failed state — not the first-run screen — when the load errored", () => {
    queryState = { isFetched: true, isError: true };
    render(<PipelinePage />);
    expect(screen.queryByText("Your pipeline is empty")).toBeNull();
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("wires the two paths to the New-customer modal and the composer", () => {
    render(<PipelinePage />);
    const frs = screen.getByText("Your pipeline is empty").closest(".frs") as HTMLElement;
    fireEvent.click(within(frs).getByRole("button", { name: "+ Add a customer" }));
    fireEvent.click(within(frs).getByRole("button", { name: "+ New quote" }));
    expect(openModal).toHaveBeenCalledWith("new-customer");
    expect(push).toHaveBeenCalledWith("/composer");
  });
});
