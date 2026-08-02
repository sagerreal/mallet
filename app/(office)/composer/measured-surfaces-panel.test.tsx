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
 * notice, load-failed); room rows opening the room card + the "+ Add a room" /
 * "Scan room" entries (with the silent estimate-job creation when the picked
 * customer has no job yet). Derive logic is covered in measured-surfaces.test.ts;
 * held seed math parity in held-trace-seed.test.ts; store/hooks/trpc mocked.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { Job, Lead, RoomCard, Service, SiteCard } from "@/lib/store/types";
import type { HeldTrace } from "@/lib/measure/held-trace";
import type { AssemblyView } from "@/lib/store/assemblies-mapper";
import { DEFAULT_ASSEMBLIES } from "@/modules/assemblies/domain/assembly-defaults";

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
  assemblies: AssemblyView[];
  roomsByJob: Record<string, RoomCard[] | undefined>;
  sitesByJob: Record<string, SiteCard[] | undefined>;
  addJob: ReturnType<typeof vi.fn>;
};
const openModal = vi.fn();
let roomsQuery: QueryStub;
let sitesQuery: QueryStub;
let scanAvailable = false;
const useJobRooms = vi.fn((_jobId: string | null) => roomsQuery);
const useJobSites = vi.fn((_jobId: string | null) => sitesQuery);
const fetchBuild = vi.fn<(input: unknown) => Promise<unknown>>();
const fetchAssemblySeed = vi.fn<(input: unknown) => Promise<unknown>>();

/** Store-shaped assembly views straight from the shipped catalog. */
const catalogViews = (): AssemblyView[] =>
  DEFAULT_ASSEMBLIES.map(
    (entry) =>
      ({
        id: `catalog:${entry.catalogKey}`,
        catalogKey: entry.catalogKey,
        name: entry.name,
        measurementBasis: entry.measurementBasis,
        pricingMode: entry.pricingMode,
        marginBps: entry.marginBps,
        jobMinimumCents: entry.jobMinimumCents,
        config: entry.config,
        active: true,
        isOverride: false,
        dials: [],
      }) as unknown as AssemblyView,
  );

vi.mock("@/lib/store/app-store", () => ({
  useAppStore: (sel: (s: Record<string, unknown>) => unknown) => sel(storeState),
  useOpenModal: () => openModal,
}));
vi.mock("@/lib/native/room-scan", () => ({
  useRoomScanAvailable: () => scanAvailable,
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
      v1: {
        quoting: { buildFromMeasurements: { fetch: fetchBuild } },
        assemblies: { seedFromCapture: { fetch: fetchAssemblySeed } },
      },
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
  edges: null,
  complexity: null,
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
  edges: null,
  complexity: null,
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

const room = (overrides: Partial<RoomCard> = {}): RoomCard => ({
  id: "r1",
  jobId: "j1",
  roomName: "Living room",
  source: "roomplan_v1",
  capturedAt: "2026-08-01T12:00:00.000Z",
  quantities: [
    { kind: "walls_sqft", value: null, derivedValue: 562, status: "derived" },
    { kind: "doors_count", value: null, derivedValue: 2, status: "derived" },
  ],
  ...overrides,
});

beforeEach(() => {
  storeState = {
    toggles: { measurementEstimating: true },
    jobs: [job({})],
    leads: [{ id: "lead-1", name: "Pat", address: "12 Elm St" } as Lead],
    services: [sqftService()],
    // Legacy default: no assemblies — every pre-assembly test keeps the direct
    // one-tap seed; the picker suite opts in via catalogViews().
    assemblies: [],
    roomsByJob: { j1: [] },
    sitesByJob: { j1: [site()] },
    addJob: vi.fn(),
  };
  roomsQuery = okQuery();
  sitesQuery = okQuery();
  scanAvailable = false;
  openModal.mockClear();
  fetchBuild.mockReset();
  fetchAssemblySeed.mockReset();
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

describe("MeasuredSurfacesPanel — room rows (the rooms home since the job modal's row left)", () => {
  beforeEach(() => {
    storeState.roomsByJob = { j1: [room()] };
    storeState.sitesByJob = { j1: [] };
  });

  it("lists a room with its figures and opens the room card from Open", () => {
    render(<MeasuredSurfacesPanel {...seededProps} />);
    expect(screen.getByText("Living room")).toBeTruthy();
    expect(screen.getByText("562 sqft walls · 2 doors · measured Aug 1")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Open Living room" }));
    expect(openModal).toHaveBeenCalledWith("room-card", { captureId: "r1", jobId: "j1" });
  });

  it("shows the Confirm badge when a quantity awaits office confirmation", () => {
    storeState.roomsByJob = {
      j1: [
        room({
          quantities: [
            { kind: "baseboard_lnft", value: null, derivedValue: 88, status: "needs_confirm" },
          ],
        }),
      ],
    };
    render(<MeasuredSurfacesPanel {...seededProps} />);
    expect(screen.getByText("Confirm")).toBeTruthy();
  });

  it("does not show a Confirm badge when nothing needs confirmation", () => {
    render(<MeasuredSurfacesPanel {...seededProps} />);
    expect(screen.queryByText("Confirm")).toBeNull();
  });
});

describe("MeasuredSurfacesPanel — add / scan a room", () => {
  it("opens the room card in create mode against the picked customer's job", () => {
    render(<MeasuredSurfacesPanel {...seededProps} />);
    fireEvent.click(screen.getByRole("button", { name: "+ Add a room" }));
    expect(openModal).toHaveBeenCalledWith("room-card", { jobId: "j1" });
    expect(storeState.addJob).not.toHaveBeenCalled();
  });

  it("shows Scan room only when the native scanner is available, in scan mode", () => {
    render(<MeasuredSurfacesPanel {...seededProps} />);
    expect(screen.queryByRole("button", { name: "Scan room" })).toBeNull();
  });

  it("opens the room card in scan mode when the scanner is available", () => {
    scanAvailable = true;
    render(<MeasuredSurfacesPanel {...seededProps} />);
    fireEvent.click(screen.getByRole("button", { name: "Scan room" }));
    expect(openModal).toHaveBeenCalledWith("room-card", { jobId: "j1", mode: "scan" });
  });

  it("renders no room entries without a picked customer — a room must anchor to a job", () => {
    render(<MeasuredSurfacesPanel {...seededProps} paramJobId={null} leadId={null} />);
    expect(screen.queryByRole("button", { name: "+ Add a room" })).toBeNull();
  });

  it("a customer with no job gets an estimate job created silently, then the room card", async () => {
    storeState.jobs = [];
    const created = job({ id: "j-new" });
    storeState.addJob.mockReturnValue({ job: created, persisted: Promise.resolve(created) });
    render(<MeasuredSurfacesPanel {...seededProps} paramJobId={null} />);

    fireEvent.click(screen.getByRole("button", { name: "+ Add a room" }));
    await waitFor(() => expect(openModal).toHaveBeenCalledWith("room-card", { jobId: "j-new" }));
    expect(storeState.addJob).toHaveBeenCalledWith(
      expect.objectContaining({ leadId: "lead-1", svc: "estimate", status: "unscheduled" }),
    );
  });

  it("a failed estimate-job create names the problem and opens nothing", async () => {
    storeState.jobs = [];
    storeState.addJob.mockReturnValue({
      job: job({ id: "j-new" }),
      persisted: Promise.reject(new Error("network")),
    });
    render(<MeasuredSurfacesPanel {...seededProps} paramJobId={null} />);

    fireEvent.click(screen.getByRole("button", { name: "+ Add a room" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "Couldn't create a job to hold this room — check your connection and try again.",
      ),
    );
    expect(openModal).not.toHaveBeenCalled();
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

describe("MeasuredSurfacesPanel — assembly picker (recipe pricing)", () => {
  it("Seed lines on a held trace opens the in-flow picker when assemblies match its basis", () => {
    storeState.assemblies = catalogViews();
    seededProps.heldTraces = [heldTrace({ areaSqft: 800, footprintSqft: 800, perimeterLnft: 120 })];
    render(<MeasuredSurfacesPanel {...seededProps} paramJobId={null} leadId={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Seed lines" }));
    // No seed yet — the office picks HOW this surface prices first.
    expect(seededProps.onSeedLines).not.toHaveBeenCalled();
    const picker = screen.getByRole("group", { name: "Price this surface with" });
    expect(picker.textContent).toContain("Driveway replacement, 3-inch");
    expect(picker.textContent).toContain("Standard rates");
  });

  it("picking an assembly seeds the full component breakdown client-side (held trace)", () => {
    storeState.assemblies = catalogViews();
    seededProps.heldTraces = [heldTrace({ areaSqft: 800, footprintSqft: 800, perimeterLnft: 120 })];
    render(<MeasuredSurfacesPanel {...seededProps} paramJobId={null} leadId={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Seed lines" }));
    fireEvent.click(screen.getByRole("button", { name: "Driveway replacement, 3-inch" }));
    expect(seededProps.onSeedLines).toHaveBeenCalledTimes(1);
    const lines = (seededProps.onSeedLines as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      description: string;
      rateCents: number;
    }[];
    expect(lines.map((l) => l.description)).toContain("Hot-mix asphalt, 3 in (16 tons)");
    expect(lines.map((l) => l.description)).toContain("Mobilization");
    // Margin applied INTO the visible rate (never a hidden adjustment).
    expect(lines.find((l) => l.description.startsWith("Hot-mix"))?.rateCents).toBe(15000);
    // Seeded — the button flips and the picker closes.
    expect(screen.getByRole("button", { name: "Seeded" })).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Price this surface with" })).toBeNull();
  });

  it("a below-minimum assembly seed surfaces the job-minimum notice", () => {
    storeState.assemblies = catalogViews();
    seededProps.heldTraces = [heldTrace({ areaSqft: 800, footprintSqft: 800, perimeterLnft: 120 })];
    render(<MeasuredSurfacesPanel {...seededProps} paramJobId={null} leadId={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Seed lines" }));
    fireEvent.click(screen.getByRole("button", { name: "Sealcoat, two coats" }));
    expect(screen.getByText("Below your $350 job minimum — priced at the minimum.")).toBeTruthy();
    const lines = (seededProps.onSeedLines as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      description: string;
    }[];
    expect(lines.map((l) => l.description)).toContain("Job minimum");
  });

  it("Standard rates inside the picker keeps the service-based seed", () => {
    storeState.assemblies = catalogViews();
    seededProps.heldTraces = [heldTrace({ areaSqft: 800, footprintSqft: 800, perimeterLnft: 120 })];
    render(<MeasuredSurfacesPanel {...seededProps} paramJobId={null} leadId={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Seed lines" }));
    fireEvent.click(screen.getByRole("button", { name: "Standard rates" }));
    const lines = (seededProps.onSeedLines as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      description: string;
    }[];
    expect(lines[0]!.description).toBe("Driveway — Seal coating");
  });

  it("a persisted site row seeds through v1.assemblies.seedFromCapture (server engine)", async () => {
    storeState.assemblies = catalogViews();
    fetchAssemblySeed.mockResolvedValue({
      lines: [
        { description: "Driveway — Sealcoat, two coats", quantity: 640, rateCents: 25, costCents: 17, optional: false, componentKey: null },
      ],
      totalCents: 35_000,
      minimum: { minimumCents: 35_000, addedCents: 19_000 },
      skipped: [],
    });
    render(<MeasuredSurfacesPanel {...seededProps} />);
    fireEvent.click(screen.getByRole("button", { name: "Seed lines" }));
    fireEvent.click(screen.getByRole("button", { name: "Sealcoat, two coats" }));
    await waitFor(() => expect(seededProps.onSeedLines).toHaveBeenCalledTimes(1));
    expect(fetchAssemblySeed).toHaveBeenCalledWith({
      jobId: "j1",
      sourceName: "Driveway",
      assemblyId: "catalog:sealcoat_two_coats",
    });
    expect(screen.getByText("Below your $350 job minimum — priced at the minimum.")).toBeTruthy();
    expect(fetchBuild).not.toHaveBeenCalled();
  });

  it("a room row never offers the picker — painting keeps the service seed", async () => {
    storeState.assemblies = catalogViews();
    storeState.roomsByJob = { j1: [room()] };
    storeState.sitesByJob = { j1: [] };
    fetchBuild.mockResolvedValue({ seedLines: [], gaps: [], unconfirmedRooms: [] });
    render(<MeasuredSurfacesPanel {...seededProps} />);
    fireEvent.click(screen.getByRole("button", { name: "Seed lines" }));
    expect(screen.queryByRole("group", { name: "Price this surface with" })).toBeNull();
    await waitFor(() => expect(fetchBuild).toHaveBeenCalled());
  });

  it("a perimeter-less manual capture only offers area assemblies", () => {
    storeState.assemblies = catalogViews();
    storeState.sitesByJob = { j1: [site({ perimeterLnft: null })] };
    render(<MeasuredSurfacesPanel {...seededProps} />);
    fireEvent.click(screen.getByRole("button", { name: "Seed lines" }));
    const picker = screen.getByRole("group", { name: "Price this surface with" });
    expect(picker.textContent).not.toContain("Crack filling");
    expect(picker.textContent).toContain("Sealcoat, two coats");
  });
});

describe("MeasuredSurfacesPanel — roofing recipes (surface-gated pickers)", () => {
  /** The 24-square classified roof: hips, no valleys → the 12% moderate tier. */
  const classifiedRoof = (): HeldTrace =>
    heldTrace({
      id: "held-roof",
      name: "Main roof",
      surface: "pitched",
      pitchRise: 6,
      footprintSqft: 2146.63,
      areaSqft: 2400,
      perimeterLnft: 260,
      edges: { eaveFt: 160, rakeFt: 100, ridgeFt: 40, hipFt: 60, valleyFt: 0 },
      complexity: { hips: 2, valleys: 0, cutUp: true },
    });

  it("a FLAT trace never offers the roofing recipes", () => {
    storeState.assemblies = catalogViews();
    seededProps.heldTraces = [heldTrace({ areaSqft: 800, footprintSqft: 800, perimeterLnft: 120 })];
    render(<MeasuredSurfacesPanel {...seededProps} paramJobId={null} leadId={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Seed lines" }));
    const picker = screen.getByRole("group", { name: "Price this surface with" });
    expect(picker.textContent).not.toContain("Asphalt shingle reroof");
    expect(picker.textContent).not.toContain("Roof tune-up");
  });

  it("a classified pitched trace seeds the reroof's component lines and says the derived waste", () => {
    storeState.assemblies = catalogViews();
    seededProps.heldTraces = [classifiedRoof()];
    render(<MeasuredSurfacesPanel {...seededProps} paramJobId={null} leadId={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Seed lines" }));
    fireEvent.click(screen.getByRole("button", { name: "Asphalt shingle reroof" }));
    const lines = (seededProps.onSeedLines as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      description: string;
    }[];
    expect(lines.map((l) => l.description)).toContain("Field shingles (81 bundles)");
    expect(lines.map((l) => l.description)).toContain("Hip and ridge cap (5 bundles)");
    // The derived waste is shown honestly, with where to change it.
    expect(
      screen.getByText("Waste 12% (hips on this roof) — change it in the Pricebook."),
    ).toBeTruthy();
  });

  it("an UNCLASSIFIED pitched trace still offers the recipe — its edge components become named gaps", () => {
    storeState.assemblies = catalogViews();
    seededProps.heldTraces = [
      heldTrace({
        id: "held-plain",
        name: "Garage roof",
        surface: "pitched",
        pitchRise: 4,
        areaSqft: 900,
        footprintSqft: 853.99,
        perimeterLnft: 130,
        edges: null,
        complexity: null,
      }),
    ];
    render(<MeasuredSurfacesPanel {...seededProps} paramJobId={null} leadId={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Seed lines" }));
    fireEvent.click(screen.getByRole("button", { name: "Asphalt shingle reroof" }));
    expect(seededProps.onSeedLines).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText(
        "Classify the roof edges on this trace to price Hip and ridge cap, Starter strip, Ice and water shield and Drip edge.",
      ),
    ).toBeTruthy();
  });

  it("a persisted PITCHED site row offers the roofing recipes; a flat one doesn't", () => {
    storeState.assemblies = catalogViews();
    storeState.sitesByJob = {
      j1: [
        site({
          id: "s-roof",
          name: "Main roof",
          surface: "pitched",
          pitchRise: 6,
          areaSqft: 2400,
          edges: { eaveFt: 160, rakeFt: 100, ridgeFt: 40, hipFt: 60, valleyFt: 0 },
          complexity: { hips: 2, valleys: 0, cutUp: true },
        }),
      ],
    };
    render(<MeasuredSurfacesPanel {...seededProps} />);
    fireEvent.click(screen.getByRole("button", { name: "Seed lines" }));
    const picker = screen.getByRole("group", { name: "Price this surface with" });
    expect(picker.textContent).toContain("Asphalt shingle reroof");
    expect(picker.textContent).toContain("Roof tune-up / repair allowance");
  });
});
