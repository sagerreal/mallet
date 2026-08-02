// @vitest-environment jsdom
/**
 * components/modals/tech-job-modal/quote-tab.test.tsx
 *
 * The Quote tab (estimating part 3): scope save wiring, the estimate-visit dual
 * exit and its DERIVED sent state (visit.scopeNotes IS the handoff — no status),
 * the embedded builder's visibility, and the scan-row gates
 * (measurementEstimating AND useRoomScanAvailable).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QuoteTab } from "./quote-tab";
import { MODAL } from "@/lib/store/modal-ids";
import type { Job, Visit } from "@/lib/store/types";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let mockJobs: Job[] = [];
let mockMeasurementEstimating = false;
let mockScanAvailable = false;

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
  useRoomScanAvailable: () => mockScanAvailable,
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
  mockMeasurementEstimating = false;
  mockScanAvailable = false;
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
// Scan a room — the two gates
// ---------------------------------------------------------------------------

describe("QuoteTab — scan a room", () => {
  it("hidden when the org doesn't measure OR the platform can't scan", () => {
    const job = makeJob();
    mockJobs = [job];
    mockMeasurementEstimating = true;
    mockScanAvailable = false;
    const { unmount } = render(<QuoteTab job={job} scopeVisit={job.visits[0]} readOnly={false} />);
    expect(screen.queryByText("Scan a room")).toBeNull();
    unmount();
    mockMeasurementEstimating = false;
    mockScanAvailable = true;
    render(<QuoteTab job={job} scopeVisit={job.visits[0]} readOnly={false} />);
    expect(screen.queryByText("Scan a room")).toBeNull();
  });

  it("shows when both gates pass and drills into the room-card scan mode", () => {
    const job = makeJob();
    mockJobs = [job];
    mockMeasurementEstimating = true;
    mockScanAvailable = true;
    render(<QuoteTab job={job} scopeVisit={job.visits[0]} readOnly={false} />);
    fireEvent.click(screen.getByText("Scan a room"));
    expect(mockPushModal).toHaveBeenCalledWith(MODAL.ROOM_CARD, { jobId: "job-1", mode: "scan" });
  });
});

// ---------------------------------------------------------------------------
// Read-only (closed job)
// ---------------------------------------------------------------------------

describe("QuoteTab — closed job", () => {
  it("offers no write controls, only Done", () => {
    const job = makeJob({ status: "done", visits: [makeVisit({ scopeNotes: "as found", status: "done" })] });
    mockJobs = [job];
    mockMeasurementEstimating = true;
    mockScanAvailable = true;
    render(<QuoteTab job={job} scopeVisit={job.visits[0]} readOnly={true} />);
    expect(screen.getByText("as found")).toBeTruthy();
    expect(screen.queryByText("Edit →")).toBeNull();
    expect(screen.queryByText("Scan a room")).toBeNull();
    expect(screen.queryByText(/Add photo/)).toBeNull();
    expect(screen.queryByText("Present to customer →")).toBeNull();
    expect(screen.getByText("Done")).toBeTruthy();
  });
});
