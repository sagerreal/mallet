import { describe, it, expect, vi, beforeEach } from "vitest";
import { createStore, type StoreApi } from "zustand/vanilla";
import { shouldSeedJobSites } from "./use-job-sites";
import { createSitesSlice, type SitesSlice } from "@/lib/store/slices/sites-slice";
import type { SiteCard } from "@/lib/store/types";

vi.mock("@/lib/trpc/vanilla", () => ({
  trpcVanilla: {
    v1: {
      measurements: {
        siteCreate: { mutate: vi.fn() },
        siteUpdate: { mutate: vi.fn().mockReturnValue(new Promise(() => {})) }, // stays in-flight
        siteArchive: { mutate: vi.fn() },
      },
    },
  },
}));

const JOB = "job-1";

const site = (overrides: Partial<SiteCard> = {}): SiteCard => ({
  id: "site-1",
  jobId: JOB,
  name: "Surface 1",
  source: "aerial_trace_v1",
  surface: "flat",
  pitchRise: null,
  areaSqft: 1240,
  footprintSqft: 1240,
  perimeterLnft: 142,
  polygon: {
    vertices: [
      { lat: 35.1, lng: -80.1 },
      { lat: 35.2, lng: -80.1 },
      { lat: 35.2, lng: -80.2 },
    ],
    view: { centerLat: 35.15, centerLng: -80.15, zoom: 20 },
  },
  createdAt: "2026-07-01T00:00:00.000Z",
  ...overrides,
});

describe("shouldSeedJobSites", () => {
  it("allows seeding when the slice has never been populated for this job (undefined)", () => {
    expect(shouldSeedJobSites(undefined)).toBe(true);
  });

  it("refuses to reseed once seeded, including a legitimately empty list", () => {
    expect(shouldSeedJobSites([])).toBe(false);
    expect(shouldSeedJobSites([site()])).toBe(false);
  });
});

// Same regression class as useJobRooms: a remount delivering stale cached data
// must not revert an optimistic edit made while the modal was open.
describe("useJobSites seed-once guard", () => {
  let store: StoreApi<SitesSlice>;

  beforeEach(() => {
    store = createStore<SitesSlice>((set, get, api) => createSitesSlice(set, get, api));
  });

  it("preserves a store edit across a simulated remount carrying stale data", () => {
    expect(shouldSeedJobSites(store.getState().sitesByJob[JOB])).toBe(true);
    store.getState().setJobSites(JOB, [site()]);

    store.getState().updateSite(JOB, "site-1", { name: "Driveway" });
    expect(store.getState().sitesByJob[JOB]![0]!.name).toBe("Driveway");

    // Remount: cached (pre-rename) list arrives — guard refuses to seed.
    expect(shouldSeedJobSites(store.getState().sitesByJob[JOB])).toBe(false);
    expect(store.getState().sitesByJob[JOB]![0]!.name).toBe("Driveway");
  });
});
