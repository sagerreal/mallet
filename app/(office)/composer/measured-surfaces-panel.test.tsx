// @vitest-environment jsdom
/**
 * app/(office)/composer/measured-surfaces-panel.test.tsx
 *
 * The panel's four states — hidden (toggle off / no job context / still
 * loading), rows, load-failed — plus the per-surface seed flow: fetch with the
 * sourceNames filter, append via onSeedLines, seed-once (button disables), the
 * empty-seed notice, and the tracer entry. Derive logic itself is covered in
 * measured-surfaces.test.ts; store/hooks/trpc are mocked here.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { Job, RoomCard, SiteCard } from "@/lib/store/types";

interface QueryStub {
  isError: boolean;
  isRefetching: boolean;
  refetch: () => void;
}
const okQuery = (): QueryStub => ({ isError: false, isRefetching: false, refetch: vi.fn() });

let storeState: {
  toggles: { measurementEstimating: boolean };
  jobs: Job[];
  roomsByJob: Record<string, RoomCard[] | undefined>;
  sitesByJob: Record<string, SiteCard[] | undefined>;
};
const openModal = vi.fn();
let roomsQuery: QueryStub;
let sitesQuery: QueryStub;
const useJobRooms = vi.fn((_jobId: string | null) => roomsQuery);
const useJobSites = vi.fn((_jobId: string | null) => sitesQuery);
const fetchBuild = vi.fn<(input: unknown) => Promise<unknown>>();

vi.mock("@/lib/store/app-store", () => ({
  useAppStore: (sel: (s: Record<string, unknown>) => unknown) => sel(storeState),
  useOpenModal: () => openModal,
}));
vi.mock("@/features/measurements/use-job-rooms", () => ({
  useJobRooms: (jobId: string | null) => useJobRooms(jobId),
}));
vi.mock("@/features/measurements/use-job-sites", () => ({
  useJobSites: (jobId: string | null) => useJobSites(jobId),
}));
vi.mock("@/lib/trpc/client", () => ({
  api: {
    useUtils: () => ({
      v1: { quoting: { buildFromMeasurements: { fetch: fetchBuild } } },
    }),
  },
}));

import { MeasuredSurfacesPanel } from "./measured-surfaces-panel";

const job = (overrides: Partial<Job>): Job =>
  ({ id: "j1", leadId: "lead-1", title: "Repaint", archived: false, ...overrides }) as Job;

const site = (overrides: Partial<SiteCard> = {}): SiteCard => ({
  id: "s1",
  jobId: "j1",
  name: "Driveway",
  source: "aerial_trace_v1",
  surface: "flat",
  pitchRise: null,
  areaSqft: 640,
  footprintSqft: 640,
  perimeterLnft: 104,
  polygon: null,
  createdAt: "2026-08-01T12:00:00.000Z",
  ...overrides,
});

const seededProps = {
  paramJobId: "j1",
  leadId: "lead-1",
  wholeJobSeeded: false,
  onSeedLines: vi.fn(),
};

beforeEach(() => {
  storeState = {
    toggles: { measurementEstimating: true },
    jobs: [job({})],
    roomsByJob: { j1: [] },
    sitesByJob: { j1: [site()] },
  };
  roomsQuery = okQuery();
  sitesQuery = okQuery();
  openModal.mockClear();
  fetchBuild.mockReset();
  seededProps.onSeedLines = vi.fn();
});

describe("MeasuredSurfacesPanel — visibility", () => {
  it("renders nothing when the org toggle is off", () => {
    storeState.toggles.measurementEstimating = false;
    const { container } = render(<MeasuredSurfacesPanel {...seededProps} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing with no job context (no ?job=, lead has no open jobs)", () => {
    storeState.jobs = [];
    const { container } = render(
      <MeasuredSurfacesPanel {...seededProps} paramJobId={null} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing while the job's measurements are still hydrating (no empty shell)", () => {
    storeState.roomsByJob = {};
    storeState.sitesByJob = {};
    render(<MeasuredSurfacesPanel {...seededProps} />);
    expect(screen.queryByText("Measured surfaces")).toBeNull();
  });
});

describe("MeasuredSurfacesPanel — rows", () => {
  it("lists each capture with its figures and a Seed lines action, plus the tracer entry", () => {
    render(<MeasuredSurfacesPanel {...seededProps} />);
    expect(screen.getByText("Measured surfaces")).toBeTruthy();
    expect(screen.getByText("Driveway")).toBeTruthy();
    expect(screen.getByText("640 sqft · 104 lnft · traced Aug 1")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Seed lines" }) as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "+ Trace from satellite" }));
    expect(openModal).toHaveBeenCalledWith("site-tracer", { jobId: "j1" });
  });

  it("a job with no captures still offers the tracer, honestly labeled", () => {
    storeState.sitesByJob = { j1: [] };
    render(<MeasuredSurfacesPanel {...seededProps} />);
    expect(screen.getByText("Nothing measured on this job yet.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "+ Trace from satellite" })).toBeTruthy();
  });

  it("shows the in-flow job selector only when 2+ of the lead's jobs have captures", () => {
    storeState.jobs = [job({}), job({ id: "j2", title: "Roof" })];
    storeState.sitesByJob = { j1: [site()], j2: [site({ id: "s2", jobId: "j2" })] };
    storeState.roomsByJob = { j1: [], j2: [] };
    render(<MeasuredSurfacesPanel {...seededProps} paramJobId={null} />);
    expect(screen.getByRole("group", { name: "Measured job" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Roof" })).toBeTruthy();
  });
});

describe("MeasuredSurfacesPanel — load failure", () => {
  it("a failed fetch with nothing cached shows the named LoadFailed state, never an empty panel", () => {
    storeState.roomsByJob = {};
    storeState.sitesByJob = {};
    roomsQuery = { ...okQuery(), isError: true };
    sitesQuery = { ...okQuery(), isError: true };
    render(<MeasuredSurfacesPanel {...seededProps} />);
    expect(screen.getByRole("alert").textContent).toContain("Couldn't load your measurements.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(roomsQuery.refetch).toHaveBeenCalled();
    expect(sitesQuery.refetch).toHaveBeenCalled();
  });
});

describe("MeasuredSurfacesPanel — seeding", () => {
  it("Seed lines fetches only that surface and appends its lines; the button then disables", async () => {
    const lines = [
      {
        description: "Driveway — Seal coating",
        quantity: 640,
        rateCents: 150,
        costCents: 40,
        measuredKind: "site_sqft",
        sourceName: "Driveway",
        serviceId: "svc-1",
      },
    ];
    fetchBuild.mockResolvedValue({ seedLines: lines, gaps: [], unconfirmedRooms: [] });
    render(<MeasuredSurfacesPanel {...seededProps} />);

    fireEvent.click(screen.getByRole("button", { name: "Seed lines" }));
    await waitFor(() =>
      expect(fetchBuild).toHaveBeenCalledWith({ jobId: "j1", sourceNames: ["Driveway"] }),
    );
    await waitFor(() => expect(seededProps.onSeedLines).toHaveBeenCalledTimes(1));
    expect(seededProps.onSeedLines).toHaveBeenCalledWith(lines);
    expect((screen.getByRole("button", { name: "Seeded" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("a ?job= boot marks every row already Seeded (the boot dropped all lines in)", () => {
    render(<MeasuredSurfacesPanel {...seededProps} wholeJobSeeded />);
    expect((screen.getByRole("button", { name: "Seeded" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("an empty per-surface seed surfaces the pricing gap instead of silently no-oping", async () => {
    fetchBuild.mockResolvedValue({ seedLines: [], gaps: [], unconfirmedRooms: [] });
    render(<MeasuredSurfacesPanel {...seededProps} />);
    fireEvent.click(screen.getByRole("button", { name: "Seed lines" }));
    await waitFor(() =>
      expect(
        screen.getByText(
          "No priced service covers Driveway yet — add one in the pricebook, then seed again.",
        ),
      ).toBeTruthy(),
    );
    expect(seededProps.onSeedLines).not.toHaveBeenCalled();
    // Not seeded — the office can fix the pricebook and try again.
    expect((screen.getByRole("button", { name: "Seed lines" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("a failed seed names the problem and keeps the button usable", async () => {
    fetchBuild.mockRejectedValue(new Error("network"));
    render(<MeasuredSurfacesPanel {...seededProps} />);
    fireEvent.click(screen.getByRole("button", { name: "Seed lines" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "Couldn't seed lines from Driveway — check your connection and try again.",
      ),
    );
    expect((screen.getByRole("button", { name: "Seed lines" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
