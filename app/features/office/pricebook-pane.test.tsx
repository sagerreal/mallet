// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// Narrow store shape — only what the pane selects.
interface Store {
  materials: { active: boolean }[];
  services: { id: string; name: string; position: number }[];
  categories: unknown[];
  laborRates: unknown[];
  terms: unknown[];
  markup: number;
  toggles: { measurementEstimating: boolean };
  trade: string;
  assemblies: unknown[];
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
  api: {
    v1: {
      pricebook: {
        service: { list: { useQuery: () => q } },
        // markup bands rail row — settled default table for these routing tests
        markupBands: { list: { useQuery: () => ({ data: { bands: [{ minCostCents: 0, markupBps: 3500 }], isDefault: true }, isFetched: true }) } },
      },
      settings: { get: { useQuery: () => q } },
    },
  },
}));
vi.mock("@/app/(office)/settings/service-row", () => ({
  ServiceRow: () => <div data-testid="svc-row" />,
}));
vi.mock("@/features/office/materials-panel", () => ({
  MaterialsPanel: () => <div data-testid="materials-panel" />,
}));
vi.mock("@/features/office/markup-bands-editor", () => ({
  MarkupBandsEditor: () => <div data-testid="bands-editor" />,
}));
vi.mock("@/app/(office)/settings/estimator-memory-card", () => ({
  EstimatorMemoryRow: () => <div data-testid="memory-row" />,
}));

import { PricebookPane } from "./pricebook-pane";

const store = (services: Store["services"]): Store => ({
  services,
  materials: [],
  categories: [],
  laborRates: [],
  terms: [],
  markup: 35,
  toggles: { measurementEstimating: false },
  trade: "plumbing",
  assemblies: [{ id: "a1" }],
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
    // Defaults rail deleted (Jul 31): the pricebook is the Services|Materials card alone.
  });

  it("populated → the register (card + rail), never the first-run screen", () => {
    storeState = store([{ id: "s1", name: "Drain cleaning", position: 0 }]);
    render(<PricebookPane />);
    expect(screen.getByTestId("svc-row")).toBeTruthy();
    // Defaults rail deleted (Jul 31): the pricebook is the Services|Materials card alone.
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

// ASSEMBLIES IS A DIFFERENT FEATURE THAT SHARED A SWITCH. Its catalog is seven paving and roofing
// recipes priced off an aerial site trace — driveway replacement, sealcoat, shingle reroof — with
// no vocabulary for a wall, a ceiling or a door. It was gated on `measurementEstimating`, which a
// painting shop MUST have on for the room scan, so Cedarline Painting opened its pricebook onto a
// paving contractor's book.
describe("PricebookPane — who sees Assemblies", () => {
  beforeEach(() => {
    q = { isFetched: true, isError: false, isRefetching: false, refetch: vi.fn() };
  });

  const paneFor = (trade: string) => {
    storeState = { ...store([{ id: "s1", name: "Interior wall painting", position: 0 }]), trade };
    render(<PricebookPane />);
  };

  it("never shows it to a painter, who has the measurement switch on for the scan", () => {
    paneFor("painting");
    expect(screen.queryByRole("button", { name: /Assemblies/ })).toBeNull();
  });

  it("still shows it to a roofer, whose recipes those are", () => {
    paneFor("roofing");
    expect(screen.getByRole("button", { name: /Assemblies/ })).toBeTruthy();
  });

  it("leaves the painter their own two segments", () => {
    paneFor("painting");
    expect(screen.getByRole("button", { name: /Services/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Materials/ })).toBeTruthy();
  });
});
