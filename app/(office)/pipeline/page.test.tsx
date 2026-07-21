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
  api: { v1: { customers: { list: { useQuery: () => queryState } } } },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/features/home/use-animated-number", () => ({ useAnimatedNumber: (n: number) => n }));
vi.mock("@/features/quotes/derive", () => ({ deriveRail: () => ({ outSum: 0, out: [], won: [], delta: null }) }));
vi.mock("@/features/pipeline/working", () => ({ deriveIntake: () => [], deriveGetting: () => [] }));
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

  it("wires the two paths to the New-customer modal and the composer", () => {
    render(<PipelinePage />);
    const frs = screen.getByText("Your pipeline is empty").closest(".frs") as HTMLElement;
    fireEvent.click(within(frs).getByRole("button", { name: "+ Add a customer" }));
    fireEvent.click(within(frs).getByRole("button", { name: "+ New quote" }));
    expect(openModal).toHaveBeenCalledWith("new-customer");
    expect(push).toHaveBeenCalledWith("/composer");
  });
});
