// @vitest-environment jsdom
/**
 * components/modals/job-site-block.test.tsx
 *
 * Guards JobSiteBlock's "Build the price" entry (aerial takeoff part 3):
 *  - the button renders only when the job has traced surfaces
 *  - clicking it closes the modal stack and routes to the composer's ?job= seed
 *    (the same navigate-away pattern job-measure-block.tsx uses)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { JobSiteBlock } from "./job-site-block";
import type { SiteCard } from "@/lib/store/types";

const JOB_ID = "job-222";

interface MockQuery {
  isFetched: boolean;
  isError: boolean;
  isRefetching: boolean;
  refetch: ReturnType<typeof vi.fn>;
}

function makeQuery(overrides: Partial<MockQuery> = {}): MockQuery {
  return {
    isFetched: true,
    isError: false,
    isRefetching: false,
    refetch: vi.fn(),
    ...overrides,
  };
}

let mockSites: SiteCard[] = [];
const pushModalMock = vi.fn();
const closeModalMock = vi.fn();
const routerPushMock = vi.fn();
const useJobSitesMock = vi.fn();

vi.mock("@/lib/store/app-store", () => ({
  usePushModal: () => pushModalMock,
  useCloseModal: () => closeModalMock,
  useAppStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ sitesByJob: { [JOB_ID]: mockSites } }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPushMock }),
}));

vi.mock("@/features/measurements/use-job-sites", () => ({
  useJobSites: (...args: unknown[]) => useJobSitesMock(...args),
}));

function makeSite(overrides: Partial<SiteCard> = {}): SiteCard {
  return {
    id: "site-1",
    jobId: JOB_ID,
    name: "Driveway",
    source: "aerial_trace_v1",
    surface: "flat",
    pitchRise: null,
    areaSqft: 640,
    footprintSqft: 640,
    perimeterLnft: 104,
    polygon: {
      vertices: [
        { lat: 35, lng: -80 },
        { lat: 35.0001, lng: -80 },
        { lat: 35, lng: -80.0001 },
      ],
      view: { centerLat: 35, centerLng: -80, zoom: 20 },
    },
    createdAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  mockSites = [];
  pushModalMock.mockReset();
  closeModalMock.mockReset();
  routerPushMock.mockReset();
  useJobSitesMock.mockReset();
  useJobSitesMock.mockReturnValue(makeQuery());
});

describe("JobSiteBlock — Build the price button", () => {
  it("does not render when the job has no traced surfaces", () => {
    render(<JobSiteBlock jobId={JOB_ID} />);
    expect(screen.queryByText("Build the price")).toBeNull();
  });

  it("closes the modal stack and routes to the composer seed when clicked", () => {
    mockSites = [makeSite()];
    render(<JobSiteBlock jobId={JOB_ID} />);

    fireEvent.click(screen.getByText("Build the price"));

    expect(closeModalMock).toHaveBeenCalled();
    expect(routerPushMock).toHaveBeenCalledWith(`/composer?job=${JOB_ID}`);
  });
});
