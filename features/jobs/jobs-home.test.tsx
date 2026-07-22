// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

interface Store { jobs: unknown[]; leads: unknown[]; invoices: unknown[]; techs: unknown[] }
let storeState: Store;
let q = { isFetched: true, isError: false };
const push = vi.fn();

vi.mock("@/lib/store/app-store", () => ({ useAppStore: (sel: (s: Store) => unknown) => sel(storeState) }));
vi.mock("@/lib/trpc/client", () => ({ api: { v1: { jobs: { list: { useQuery: () => q } } } } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/features/jobs/hooks", () => ({ useCallbackCandidates: () => ({ data: [] }) }));
vi.mock("@/features/home/use-animated-number", () => ({ useAnimatedNumber: (n: number) => n }));
vi.mock("./use-jobs-sort", () => ({ useJobsSort: () => ({ sort: null, setSort: vi.fn() }) }));
vi.mock("./jobs-list-view", () => ({ JobsListView: () => <div data-testid="list" /> }));
vi.mock("./callback-autopsy-card", () => ({ CallbackAutopsyCard: () => null }));
vi.mock("./jobs-toolbar", () => ({ JobsToolbar: () => <div data-testid="toolbar" /> }));
vi.mock("./jobs-filters", () => ({ JobsFilters: () => <div /> }));
vi.mock("./jobs-columns", () => ({ JobsColumns: () => <div /> }));

import { JobsHome } from "./jobs-home";

const store = (jobs: unknown[]): Store => ({ jobs, leads: [], invoices: [], techs: [] });
const setup = () => {
  const onOpenNewJob = vi.fn();
  render(<JobsHome onOpenJob={vi.fn()} onOpenNewJob={onOpenNewJob} />);
  return { onOpenNewJob };
};

describe("JobsHome — first-run empty state", () => {
  beforeEach(() => { storeState = store([]); q = { isFetched: true, isError: false }; vi.clearAllMocks(); });

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
    storeState = store([{ id: "j1" }]);
    setup();
    expect(screen.queryByText(/Jobs land here/)).toBeNull();
    expect(screen.getByTestId("toolbar")).toBeTruthy();
    expect(screen.getByTestId("list")).toBeTruthy();
  });

  it("shows a loading line — not the first-run screen, toolbar, or 'No jobs yet' copy — while first-loading", () => {
    q = { isFetched: false, isError: false };
    setup();
    expect(screen.getByText("Loading…")).toBeTruthy();
    expect(screen.queryByText(/Jobs land here/)).toBeNull(); // not the rich first-run
    expect(screen.queryByText(/create one/)).toBeNull(); // not the compact "No jobs yet — create one" flash
    expect(screen.queryByTestId("toolbar")).toBeNull();
  });

  it("shows the load-failed state — not the first-run screen — when the load errored", () => {
    q = { isFetched: true, isError: true };
    setup();
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(screen.queryByText(/Jobs land here/)).toBeNull();
  });

  it("does not show the loading line once jobs are present, even mid-refetch", () => {
    storeState = store([{ id: "j1" }]);
    q = { isFetched: false, isError: false };
    setup();
    expect(screen.queryByText("Loading…")).toBeNull();
    expect(screen.getByTestId("toolbar")).toBeTruthy();
    expect(screen.getByTestId("list")).toBeTruthy();
  });
});
