// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// Narrow store shape — only what the pane selects.
interface Store {
  services: { id: string; name: string; position: number }[];
  categories: unknown[];
  laborRates: unknown[];
  terms: unknown[];
  markup: number;
  toggles: { measurementEstimating: boolean };
  addService: () => void;
  updateService: () => void;
  archiveService: () => void;
  addCategory: () => void;
  seedPricebook: () => Promise<{ ok: boolean }>;
  addLaborRate: () => void;
  updateLaborRate: () => void;
  removeLaborRate: () => void;
  setMarkup: () => void;
  addTerm: () => void;
  removeTerm: () => void;
  openModal: () => void;
}
let storeState: Store;
let q = { isFetched: true, isError: false, isRefetching: false, refetch: vi.fn() };

vi.mock("@/lib/store/app-store", () => ({
  useAppStore: (sel: (s: Store) => unknown) => sel(storeState),
  useOpenModal: () => vi.fn(),
}));
vi.mock("@/features/identity/hooks", () => ({
  useMe: () => ({ data: { role: "owner" } }),
}));
vi.mock("@/lib/trpc/client", () => ({
  // settings.get rides along since the rail now gates on the settings hydrator (rates/markup/terms).
  api: { v1: { pricebook: { service: { list: { useQuery: () => q } } }, settings: { get: { useQuery: () => q } } } },
}));
vi.mock("@/app/(office)/settings/service-row", () => ({
  ServiceRow: () => <div data-testid="svc-row" />,
}));
vi.mock("@/app/(office)/settings/estimator-memory-card", () => ({
  EstimatorMemoryRow: () => <div data-testid="memory-row" />,
}));

import { PricebookPane } from "./pricebook-pane";

const store = (services: Store["services"]): Store => ({
  services,
  categories: [],
  laborRates: [],
  terms: [],
  markup: 35,
  toggles: { measurementEstimating: false },
  addService: vi.fn(),
  updateService: vi.fn(),
  archiveService: vi.fn(),
  addCategory: vi.fn(),
  seedPricebook: vi.fn(async () => ({ ok: true })),
  addLaborRate: vi.fn(),
  updateLaborRate: vi.fn(),
  removeLaborRate: vi.fn(),
  setMarkup: vi.fn(),
  addTerm: vi.fn(),
  removeTerm: vi.fn(),
  openModal: vi.fn(),
});

describe("PricebookPane — the four list states", () => {
  beforeEach(() => {
    storeState = store([]);
    q = { isFetched: true, isError: false, isRefetching: false, refetch: vi.fn() };
  });

  it("loaded + empty → the first-run screen (trade seed primary, build-your-own)", () => {
    render(<PricebookPane />);
    expect(screen.getByText("No services yet")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start with plumbing basics" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "+ Add a service" })).toBeTruthy();
    expect(screen.queryByTestId("svc-row")).toBeNull();
    // The Defaults rail stays out of the way on first-run.
    expect(screen.queryByText("Defaults")).toBeNull();
  });

  it("'+ Add a service' drops into the empty register with the add row", () => {
    render(<PricebookPane />);
    fireEvent.click(screen.getByRole("button", { name: "+ Add a service" }));
    expect(screen.queryByText("No services yet")).toBeNull();
    expect(screen.getByPlaceholderText("e.g. Hydro-jet kitchen drain")).toBeTruthy();
    expect(screen.getByText("Defaults")).toBeTruthy();
  });

  it("populated → the register (card + rail), never the first-run screen", () => {
    storeState = store([{ id: "s1", name: "Drain cleaning", position: 0 }]);
    render(<PricebookPane />);
    expect(screen.getByTestId("svc-row")).toBeTruthy();
    expect(screen.getByText("Defaults")).toBeTruthy();
    expect(screen.queryByText("No services yet")).toBeNull();
  });

  it("cold load → quiet loading, no first-run flash", () => {
    q = { ...q, isFetched: false };
    render(<PricebookPane />);
    expect(screen.queryByText("No services yet")).toBeNull();
    expect(screen.getByText("Loading pricebook…")).toBeTruthy();
  });

  it("load errored → LoadFailed with retry, never 'no services'", () => {
    q = { ...q, isError: true };
    render(<PricebookPane />);
    expect(screen.queryByText("No services yet")).toBeNull();
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});
