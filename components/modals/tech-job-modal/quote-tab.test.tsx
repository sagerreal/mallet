// @vitest-environment jsdom
/**
 * components/modals/tech-job-modal/quote-tab.test.tsx
 *
 * The Quote tab (estimating part 3): scope save wiring, the estimate-visit dual
 * exit and its DERIVED sent state (visit.scopeNotes IS the handoff — no status),
 * the embedded builder's visibility, and the scan row's states — it renders on every device now
 * (live / disabled-no-LiDAR / disabled-not-in-the-app / disabled-job-closed /
 * disabled-settings-unknown), and the ONLY thing that hides it is a settings snapshot that
 * arrived and said this shop does not measure.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QuoteTab } from "./quote-tab";
import { MODAL } from "@/lib/store/modal-ids";
import type { Job, Visit } from "@/lib/store/types";
import type { RoomScanAvailability } from "@/lib/native/room-scan";
import type { MeasurementGate } from "@/lib/measurement-gate";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let mockJobs: Job[] = [];
let mockMeasurementEstimating: MeasurementGate = "unknown";
let mockScan: RoomScanAvailability = { status: "no-native-app" };

const noop = vi.fn();
const mockPushModal = vi.fn();
const mockClose = vi.fn();
const mockSetVisitNotes = vi.fn();
const mockAdoptJobPhotoPath = vi.fn();

vi.mock("@/lib/store/app-store", () => ({
  useAppStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      jobs: mockJobs,
      leads: [],
      services: [],
      laborRates: [],
      brand: { name: "E2E Plumbing" },
      toggles: { measurementEstimating: mockMeasurementEstimating, techSeesPrice: true },
      setVisitNotes: mockSetVisitNotes,
      adoptJobPhotoPath: mockAdoptJobPhotoPath,
      signJobQuote: noop,
    }),
  usePushModal: () => mockPushModal,
  useCloseModal: () => mockClose,
}));

vi.mock("@/lib/native/room-scan", () => ({
  useRoomScanAvailability: () => mockScan,
}));

// Keep supabase/browser out of jsdom — the strip's upload path is exercised elsewhere.
vi.mock("@/lib/store/upload-field-photo", () => ({ uploadFieldPhoto: vi.fn() }));
vi.mock("@/lib/images/downscale", () => ({ downscaleImage: vi.fn() }));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeVisit(overrides: Partial<Visit> = {}): Visit {
  return { id: "v1", date: "2026-08-01", techId: "tech-1", start: 9, dur: 1, status: "scheduled", ...overrides };
}

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: "job-1",
    leadId: "lead-1",
    svc: "service",
    origin: "db",
    title: "Fix water heater",
    addr: "",
    phone: "",
    status: "scheduled",
    archived: false,
    lines: [],
    addons: [],
    photos: [],
    notes: "",
    acts: [],
    visits: [makeVisit()],
    ...overrides,
  } as Job;
}

beforeEach(() => {
  mockJobs = [makeJob()];
  mockMeasurementEstimating = "off";
  mockScan = { status: "no-native-app" };
  mockPushModal.mockClear();
  mockClose.mockClear();
  mockSetVisitNotes.mockReset();
  mockSetVisitNotes.mockResolvedValue({ ok: true });
  mockAdoptJobPhotoPath.mockClear();
});

// ---------------------------------------------------------------------------
// Normal (repair) job — Scope + the embedded builder, no dual exit
// ---------------------------------------------------------------------------

describe("QuoteTab — normal job", () => {
  it("renders Scope and the embedded builder with the present primary", () => {
    const job = makeJob();
    mockJobs = [job];
    render(<QuoteTab job={job} scopeVisit={job.visits[0]} readOnly={false} />);
    expect(screen.getByText("Scope")).toBeTruthy();
    expect(screen.getByText("The price")).toBeTruthy();
    expect(screen.getByText("Present to customer →")).toBeTruthy();
    // No estimate exits on a repair.
    expect(screen.queryByText("Quote it now")).toBeNull();
    expect(screen.queryByText("Send scope to the office")).toBeNull();
  });

  it("the present primary is disabled until something is priced", () => {
    const job = makeJob();
    mockJobs = [job];
    render(<QuoteTab job={job} scopeVisit={job.visits[0]} readOnly={false} />);
    expect((screen.getByText("Present to customer →") as HTMLButtonElement).disabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The good/better/best opt-in. It is ONE bordered row under "+ Add a line" — the
// question and what it buys on the left, "Set up →" on the right — instead of a
// muted caption with two loose chips under it. The two opt-ins themselves are
// unchanged; they expand IN FLOW under the row (no floating UI).
// ---------------------------------------------------------------------------

describe("QuoteTab — the customer-choices row", () => {
  const pricedJob = () => makeJob({ lines: [{ d: "Flat rate", q: 1, r: 185 }] } as Partial<Job>);

  it("is absent until something is priced — there is nothing to offer options on", () => {
    const job = makeJob();
    mockJobs = [job];
    render(<QuoteTab job={job} scopeVisit={job.visits[0]} readOnly={false} />);
    expect(screen.queryByText("Give the customer choices?")).toBeNull();
  });

  it("reads as one row: question, what it buys, and a single 'Set up →' action", () => {
    const job = pricedJob();
    mockJobs = [job];
    render(<QuoteTab job={job} scopeVisit={job.visits[0]} readOnly={false} />);
    expect(screen.getByText("Give the customer choices?")).toBeTruthy();
    expect(screen.getByText("Add cheaper or premium options")).toBeTruthy();
    expect(screen.getByText("Set up →")).toBeTruthy();
    // At rest the options are behind the row, not loose under the price block.
    expect(screen.queryByText("+ Add a cheaper option")).toBeNull();
    expect(screen.queryByText("+ Add a premium option")).toBeNull();
  });

  it("'Set up' expands BOTH opt-ins in flow, and says so to a screen reader", () => {
    const job = pricedJob();
    mockJobs = [job];
    render(<QuoteTab job={job} scopeVisit={job.visits[0]} readOnly={false} />);
    const head = screen.getByText("Give the customer choices?").closest("button")!;
    expect(head.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(head);
    expect(head.getAttribute("aria-expanded")).toBe("true");
    const body = document.getElementById(head.getAttribute("aria-controls")!);
    expect(body).toBeTruthy();
    expect(screen.getByText("+ Add a cheaper option")).toBeTruthy();
    expect(screen.getByText("+ Add a premium option")).toBeTruthy();
  });

  it("the opt-ins still do what they did — a tier is added and the row drops it", () => {
    const job = pricedJob();
    mockJobs = [job];
    render(<QuoteTab job={job} scopeVisit={job.visits[0]} readOnly={false} />);
    fireEvent.click(screen.getByText("Give the customer choices?"));
    fireEvent.click(screen.getByText("+ Add a premium option"));

    // Opting in turns the builder multi-tier and lands the editor on the new tier.
    expect(screen.getByText("Present options →")).toBeTruthy();
    expect(screen.getByText("Best total")).toBeTruthy();
    // …and the taken option is no longer on offer, while the other still is.
    expect(screen.queryByText("+ Add a premium option")).toBeNull();
    expect(screen.getByText("+ Add a cheaper option")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Scope save
// ---------------------------------------------------------------------------

describe("QuoteTab — scope save", () => {
  it("tap → edit → Save writes through setVisitNotes with the visit id", async () => {
    const job = makeJob();
    mockJobs = [job];
    render(<QuoteTab job={job} scopeVisit={job.visits[0]} readOnly={false} />);
    fireEvent.click(screen.getByText(/What you saw on site/));
    const box = screen.getByLabelText("Scope notes");
    fireEvent.change(box, { target: { value: "Two doors, tight attic access" } });
    fireEvent.click(screen.getByText("Save scope"));
    await vi.waitFor(() => {
      expect(mockSetVisitNotes).toHaveBeenCalledWith("job-1", "v1", "Two doors, tight attic access");
    });
    // Editor closes on success.
    await vi.waitFor(() => {
      expect(screen.queryByLabelText("Scope notes")).toBeNull();
    });
  });

  it("surfaces the server's refusal instead of closing the editor", async () => {
    mockSetVisitNotes.mockResolvedValue({ ok: false, error: "this job isn't assigned to you" });
    const job = makeJob();
    mockJobs = [job];
    render(<QuoteTab job={job} scopeVisit={job.visits[0]} readOnly={false} />);
    fireEvent.click(screen.getByText(/What you saw on site/));
    fireEvent.change(screen.getByLabelText("Scope notes"), { target: { value: "x" } });
    fireEvent.click(screen.getByText("Save scope"));
    expect(await screen.findByText("this job isn't assigned to you")).toBeTruthy();
    expect(screen.getByLabelText("Scope notes")).toBeTruthy();
  });

  it("shows saved scope notes with an Edit affordance", () => {
    const job = makeJob({ visits: [makeVisit({ scopeNotes: "40 ft of baseboard" })] });
    mockJobs = [job];
    render(<QuoteTab job={job} scopeVisit={job.visits[0]} readOnly={false} />);
    expect(screen.getByText("40 ft of baseboard")).toBeTruthy();
    expect(screen.getByText("Edit →")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Estimate visit — the dual exit
// ---------------------------------------------------------------------------

describe("QuoteTab — estimate dual exit", () => {
  const estJob = (visits: Visit[] = [makeVisit()]) => makeJob({ svc: "estimate", visits });

  it("shows BOTH exits (no builder) on an unscoped, unquoted estimate visit", () => {
    const job = estJob();
    mockJobs = [job];
    render(<QuoteTab job={job} scopeVisit={job.visits[0]} readOnly={false} />);
    expect(screen.getByText("Quote it now")).toBeTruthy();
    expect(screen.getByText("Send scope to the office")).toBeTruthy();
    expect(screen.queryByText("Present to customer →")).toBeNull();
    // The old dead end is gone.
    expect(screen.queryByText(/the office builds the quote$/)).toBeNull();
  });

  it("'Quote it now' reveals the builder + present flow", () => {
    const job = estJob();
    mockJobs = [job];
    render(<QuoteTab job={job} scopeVisit={job.visits[0]} readOnly={false} />);
    fireEvent.click(screen.getByText("Quote it now"));
    expect(screen.getByText("The price")).toBeTruthy();
    expect(screen.getByText("Present to customer →")).toBeTruthy();
    expect(screen.queryByText("Send scope to the office")).toBeNull();
  });

  it("'Send scope to the office' with nothing written names the problem and opens the editor", () => {
    const job = estJob();
    mockJobs = [job];
    render(<QuoteTab job={job} scopeVisit={job.visits[0]} readOnly={false} />);
    fireEvent.click(screen.getByText("Send scope to the office"));
    expect(screen.getByText("Write what you saw first — the office quotes from your notes.")).toBeTruthy();
    expect(screen.getByLabelText("Scope notes")).toBeTruthy();
    expect(mockSetVisitNotes).not.toHaveBeenCalled();
  });

  it("a visit carrying scope notes IS sent — quiet confirmation, notes still editable", () => {
    const job = estJob([makeVisit({ scopeNotes: "two doors" })]);
    mockJobs = [job];
    render(<QuoteTab job={job} scopeVisit={job.visits[0]} readOnly={false} />);
    expect(screen.getByText(/the office builds the quote from your scope/)).toBeTruthy();
    expect(screen.queryByText("Send scope to the office")).toBeNull();
    // Still editable, and quoting on site stays open.
    expect(screen.getByText("Edit →")).toBeTruthy();
    expect(screen.getByText("Quote it now")).toBeTruthy();
  });

  it("an already-quoted estimate job goes straight to the builder (no dual exit)", () => {
    const job = makeJob({ svc: "estimate", lines: [{ d: "Repaint hall", q: 1, r: 400 }] });
    mockJobs = [job];
    render(<QuoteTab job={job} scopeVisit={job.visits[0]} readOnly={false} />);
    expect(screen.queryByText("Quote it now")).toBeNull();
    expect(screen.getByText("Present to customer →")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Scan a room — three states. This row is the App Store 4.2 defense: it must be
// VISIBLE on a base iPhone and in a browser, not hidden, so a reviewer who cannot
// run the scanner can still see the app has one and read what it needs.
// ---------------------------------------------------------------------------

describe("QuoteTab — scan a room", () => {
  function renderScanRow(scan: RoomScanAvailability) {
    const job = makeJob();
    mockJobs = [job];
    mockMeasurementEstimating = "on";
    mockScan = scan;
    return render(<QuoteTab job={job} scopeVisit={job.visits[0]} readOnly={false} />);
  }

  it("state 1 — live on a LiDAR device, drilling into the room-card scan mode", () => {
    renderScanRow({ status: "ready" });
    const button = screen.getByRole("button", { name: "Scan a room" });

    expect(button).toHaveProperty("disabled", false);
    fireEvent.click(button);
    expect(mockPushModal).toHaveBeenCalledWith(MODAL.ROOM_CARD, { jobId: "job-1", mode: "scan" });
  });

  it("state 2 — present but disabled on an iPhone without LiDAR, naming the device", () => {
    renderScanRow({ status: "no-lidar" });
    const button = screen.getByRole("button", { name: "Scan a room" });

    expect(button).toHaveProperty("disabled", true);
    expect(
      screen.getByText(
        "This device reports no LiDAR sensor — room scanning needs an iPhone Pro or iPad Pro.",
      ),
    ).toBeTruthy();
  });

  it("state 2 — the disabled row cannot be activated", () => {
    renderScanRow({ status: "no-lidar" });
    fireEvent.click(screen.getByRole("button", { name: "Scan a room" }));
    expect(mockPushModal).not.toHaveBeenCalled();
  });

  it("state 3 — present but disabled in a browser, naming the app, not the device", () => {
    renderScanRow({ status: "no-native-app" });
    const button = screen.getByRole("button", { name: "Scan a room" });

    expect(button).toHaveProperty("disabled", true);
    expect(
      screen.getByText("Open the Mallet iPhone app to scan — a browser cannot reach the LiDAR sensor."),
    ).toBeTruthy();
    expect(screen.queryByText(/iPhone Pro or iPad Pro/)).toBeNull();
  });

  it("state 3 — the browser row cannot be activated", () => {
    renderScanRow({ status: "no-native-app" });
    fireEvent.click(screen.getByRole("button", { name: "Scan a room" }));
    expect(mockPushModal).not.toHaveBeenCalled();
  });

  it("every disabled state announces its reason with the control", () => {
    for (const status of ["checking", "no-lidar", "no-native-app", "scanner-missing"] as const) {
      const { unmount } = renderScanRow({ status });
      const button = screen.getByRole("button", { name: "Scan a room" });
      const reasonId = button.getAttribute("aria-describedby");
      expect(reasonId, status).toBeTruthy();
      expect(document.getElementById(reasonId as string)?.textContent, status).toBeTruthy();
      unmount();
    }
  });

  it("hidden ONLY when settings arrived and said the org does not measure", () => {
    const job = makeJob();
    mockJobs = [job];
    mockMeasurementEstimating = "off";
    mockScan = { status: "ready" };
    render(<QuoteTab job={job} scopeVisit={job.visits[0]} readOnly={false} />);
    expect(screen.queryByText("Scan a room")).toBeNull();
  });

  /**
   * A settings read can be in flight or fail like any other. The gate's third state exists so that
   * does not silently delete the field scanner: unknown fails OPEN — into a VISIBLE row.
   *
   * Not into a LIVE one. Failing open the other way is the wrong trade: on a LiDAR iPhone, a shop
   * that deliberately turned measuring off would get a tappable scanner during any settings
   * outage, and the tap creates an estimate job server-side. Visible, disabled, and honest about
   * why costs a reload; live costs rows in someone's database.
   */
  it("renders DISABLED with its reason when settings have NOT loaded — visible, never live", () => {
    const job = makeJob();
    mockJobs = [job];
    mockMeasurementEstimating = "unknown";
    mockScan = { status: "ready" };
    render(<QuoteTab job={job} scopeVisit={job.visits[0]} readOnly={false} />);

    const button = screen.getByRole("button", { name: "Scan a room" });
    expect(button).toHaveProperty("disabled", true);
    expect(
      screen.getByText("Couldn't load this shop's settings — reload the page to scan a room."),
    ).toBeTruthy();
    const reasonId = button.getAttribute("aria-describedby");
    expect(document.getElementById(reasonId as string)?.textContent).toBe(
      "Couldn't load this shop's settings — reload the page to scan a room.",
    );
  });

  it("an unknown gate cannot open the room card — no estimate job is created", () => {
    const job = makeJob();
    mockJobs = [job];
    mockMeasurementEstimating = "unknown";
    mockScan = { status: "ready" };
    render(<QuoteTab job={job} scopeVisit={job.visits[0]} readOnly={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Scan a room" }));
    expect(mockPushModal).not.toHaveBeenCalled();
  });

  it("the DEVICE still outranks an unknown gate — a browser is told to open the app", () => {
    const job = makeJob();
    mockJobs = [job];
    mockMeasurementEstimating = "unknown";
    mockScan = { status: "no-native-app" };
    render(<QuoteTab job={job} scopeVisit={job.visits[0]} readOnly={false} />);
    expect(
      screen.getByText("Open the Mallet iPhone app to scan — a browser cannot reach the LiDAR sensor."),
    ).toBeTruthy();
  });

  it("an unknown gate outranks a CLOSED job — reopening it would not make the scan work", () => {
    const job = makeJob({ status: "done" });
    mockJobs = [job];
    mockMeasurementEstimating = "unknown";
    mockScan = { status: "ready" };
    render(<QuoteTab job={job} scopeVisit={job.visits[0]} readOnly={true} />);
    expect(
      screen.getByText("Couldn't load this shop's settings — reload the page to scan a room."),
    ).toBeTruthy();
    expect(screen.queryByText("This job is closed — reopen it to scan a room.")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Read-only (closed job)
// ---------------------------------------------------------------------------

describe("QuoteTab — closed job", () => {
  it("offers no write controls, only Done", () => {
    const job = makeJob({ status: "done", visits: [makeVisit({ scopeNotes: "as found", status: "done" })] });
    mockJobs = [job];
    mockMeasurementEstimating = "on";
    mockScan = { status: "ready" };
    render(<QuoteTab job={job} scopeVisit={job.visits[0]} readOnly={true} />);
    expect(screen.getByText("as found")).toBeTruthy();
    expect(screen.queryByText("Edit →")).toBeNull();
    expect(screen.queryByText(/Add photo/)).toBeNull();
    expect(screen.queryByText("Present to customer →")).toBeNull();
    expect(screen.getByText("Done")).toBeTruthy();
  });

  /**
   * This is the office job sheet too, and the demo shop seeds three COMPLETE jobs — so an owner
   * opening one used to get Scope, photos, and a silently missing scanner. `!readOnly` was hiding
   * it, which is exactly the unexplained absence this component exists to prevent. State the
   * reason instead.
   */
  it("shows the scanner DISABLED with the job-closed reason, never absent", () => {
    const job = makeJob({ status: "done", visits: [makeVisit({ scopeNotes: "as found", status: "done" })] });
    mockJobs = [job];
    mockMeasurementEstimating = "on";
    mockScan = { status: "ready" };
    render(<QuoteTab job={job} scopeVisit={job.visits[0]} readOnly={true} />);

    const button = screen.getByRole("button", { name: "Scan a room" });
    expect(button).toHaveProperty("disabled", true);
    expect(screen.getByText("This job is closed — reopen it to scan a room.")).toBeTruthy();

    fireEvent.click(button);
    expect(mockPushModal).not.toHaveBeenCalled();
  });
});
