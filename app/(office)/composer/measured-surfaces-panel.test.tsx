// @vitest-environment jsdom
/**
 * app/(office)/composer/measured-surfaces-panel.test.tsx
 *
 * The Measure section — satellite measurement's quote-page entry. States under
 * test: hidden only when the org toggle is off; the always-available "Measure
 * from satellite" entry (no customer, no job — held-mode params with the
 * picked customer's address prefilled); held-trace rows with CLIENT-side
 * seeding (seed-once, pricing-gap notice); the picked customer's job capture
 * rows with the server seed flow (sourceNames filter, seed-once, empty-seed
 * notice, load-failed). Derive logic is covered in measured-surfaces.test.ts;
 * held seed math parity in held-trace-seed.test.ts; store/hooks/trpc mocked.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { Job, Lead, RoomCard, Service, SiteCard } from "@/lib/store/types";
import type { HeldTrace } from "@/lib/measure/held-trace";

interface QueryStub {
  isError: boolean;
  isRefetching: boolean;
  refetch: () => void;
}
const okQuery = (): QueryStub => ({ isError: false, isRefetching: false, refetch: vi.fn() });

let storeState: {
  toggles: { measurementEstimating: boolean };
  jobs: Job[];
  leads: Lead[];
  services: Service[];
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

const heldTrace = (overrides: Partial<HeldTrace> = {}): HeldTrace => ({
  id: "held-1",
  name: "Driveway",
  surface: "flat",
  pitchRise: null,
  polygon: {
    vertices: [
      { lat: 1, lng: 1 },
      { lat: 1, lng: 2 },
      { lat: 2, lng: 2 },
    ],
    view: { centerLat: 1.5, centerLng: 1.5, zoom: 20 },
  },
  footprintSqft: 640,
  perimeterLnft: 104,
  areaSqft: 640,
  ...overrides,
});

const sqftService = (overrides: Partial<Service> = {}): Service =>
  ({
    id: "svc-1",
    name: "Seal coating",
    unitPrice: 1.5,
    cost: 0.4,
    active: true,
    position: 0,
    measuredBy: "site_sqft",
    ...overrides,
  }) as Service;

const seededProps = {
  paramJobId: "j1",
  leadId: "lead-1",
  wholeJobSeeded: false,
  heldTraces: [] as readonly HeldTrace[],
  onAddHeldTrace: vi.fn(),
  onSeedLines: vi.fn(),
};

beforeEach(() => {
  storeState = {
    toggles: { measurementEstimating: true },
    jobs: [job({})],
    leads: [{ id: "lead-1", name: "Pat", address: "12 Elm St" } as Lead],
    services: [sqftService()],
    roomsByJob: { j1: [] },
    sitesByJob: { j1: [site()] },
  };
  roomsQuery = okQuery();
  sitesQuery = okQuery();
  openModal.mockClear();
  fetchBuild.mockReset();
  seededProps.onSeedLines = vi.fn();
  seededProps.onAddHeldTrace = vi.fn();
  seededProps.heldTraces = [];
});

describe("MeasuredSurfacesPanel — visibility", () => {
  it("renders nothing when the org toggle is off", () => {
    storeState.toggles.measurementEstimating = false;
    const { container } = render(<MeasuredSurfacesPanel {...seededProps} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders the Measure entry with NO customer and NO job — zero prerequisites", () => {
    storeState.jobs = [];
    storeState.leads = [];
    render(<MeasuredSurfacesPanel {...seededProps} paramJobId={null} leadId={null} />);
    expect(screen.getByText("Measure")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Measure from satellite" })).toBeTruthy();
  });

  it("holds JOB rows back while a job's measurements hydrate — the entry still renders", () => {
    storeState.roomsByJob = {};
    storeState.sitesByJob = {};
    render(<MeasuredSurfacesPanel {...seededProps} />);
    expect(screen.getByRole("button", { name: "Measure from satellite" })).toBeTruthy();
    expect(screen.queryByText("Driveway")).toBeNull();
  });
});

describe("MeasuredSurfacesPanel — the tracer entry (held mode)", () => {
  it("opens the tracer with NO job attached — the trace comes back held on the quote", () => {
    seededProps.heldTraces = [heldTrace({ id: "h-prev", name: "Front walk" })];
    render(<MeasuredSurfacesPanel {...seededProps} paramJobId={null} leadId={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Measure from satellite" }));
    expect(openModal).toHaveBeenCalledWith("site-tracer", {
      held: true,
      address: "",
      // Held names ride along so the tracer's default "Surface N" never collides.
      existingNames: ["Front walk"],
      onSaveHeld: seededProps.onAddHeldTrace,
    });
  });

  it("prefills the picked customer's address", () => {
    render(<MeasuredSurfacesPanel {...seededProps} paramJobId={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Measure from satellite" }));
    const params = openModal.mock.calls[0]?.[1] as { address: string };
    expect(params.address).toBe("12 Elm St");
  });
});

describe("MeasuredSurfacesPanel — held-trace rows (client seed)", () => {
  it("lists a held trace with its figures and seeds lines with pure client math", () => {
    seededProps.heldTraces = [heldTrace()];
    render(<MeasuredSurfacesPanel {...seededProps} paramJobId={null} leadId={null} />);
    expect(screen.getByText("Driveway")).toBeTruthy();
    expect(screen.getByText("640 sqft · 104 lnft")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Seed lines" }));
    expect(seededProps.onSeedLines).toHaveBeenCalledWith([
      { description: "Driveway — Seal coating", quantity: 640, rateCents: 150, costCents: 40 },
    ]);
    // Seed-once: the button flips to Seeded and disables.
    expect((screen.getByRole("button", { name: "Seeded" }) as HTMLButtonElement).disabled).toBe(true);
    expect(fetchBuild).not.toHaveBeenCalled();
  });

  it("a held trace with no priced service surfaces the pricing gap instead of silently no-oping", () => {
    storeState.services = [];
    seededProps.heldTraces = [heldTrace()];
    render(<MeasuredSurfacesPanel {...seededProps} paramJobId={null} leadId={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Seed lines" }));
    expect(
      screen.getByText(
        "No priced service covers Driveway yet — add one in the pricebook, then seed again.",
      ),
    ).toBeTruthy();
    expect(seededProps.onSeedLines).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "Seed lines" }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("MeasuredSurfacesPanel — job capture rows", () => {
  it("lists each capture with its figures, a Seed lines action, and Open on site rows", () => {
    render(<MeasuredSurfacesPanel {...seededProps} />);
    expect(screen.getByText("Measure")).toBeTruthy();
    expect(screen.getByText("Driveway")).toBeTruthy();
    expect(screen.getByText("640 sqft · 104 lnft · traced Aug 1")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Seed lines" }) as HTMLButtonElement).disabled).toBe(false);

    // The saved capture opens from here — the job modal's row is gone.
    fireEvent.click(screen.getByRole("button", { name: "Open Driveway" }));
    expect(openModal).toHaveBeenCalledWith("site-tracer", { jobId: "j1", captureId: "s1" });
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

describe("MeasuredSurfacesPanel — job-row seeding (server)", () => {
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
