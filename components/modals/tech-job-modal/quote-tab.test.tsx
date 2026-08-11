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
const mockOnSigned = vi.fn();
const mockSetVisitNotes = vi.fn();
const mockAdoptJobPhotoPath = vi.fn();
const mockSignJobQuote = vi.fn();
const mockSaveQuoteDraft = vi.fn(() => Promise.resolve({ ok: true }));
const mockSignChangeOrder = vi.fn(() => Promise.resolve({ ok: true }));
const mockAddAddonField = vi.fn();

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
      signJobQuote: mockSignJobQuote,
      // Save-on-leave: the builder writes the field draft when it unmounts.
      saveQuoteDraft: mockSaveQuoteDraft,
      signChangeOrder: mockSignChangeOrder,
      addAddonField: mockAddAddonField,
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
  mockSaveQuoteDraft.mockClear();
  mockSignChangeOrder.mockClear();
  mockAddAddonField.mockClear();
  mockMeasurementEstimating = "off";
  mockScan = { status: "no-native-app" };
  mockPushModal.mockClear();
  mockClose.mockClear();
  mockOnSigned.mockClear();
  mockSetVisitNotes.mockReset();
  mockSetVisitNotes.mockResolvedValue({ ok: true });
  mockAdoptJobPhotoPath.mockClear();
  mockSignJobQuote.mockReset();
  mockSignJobQuote.mockResolvedValue({ ok: true });
});

// ---------------------------------------------------------------------------
// Normal (repair) job — Scope + the embedded builder, no dual exit
// ---------------------------------------------------------------------------

// Scope UI lives ONLY on the estimate chooser now (Owen's picked design) — these helpers
// render that surface and open the relevant row for the scope/photos/scan suites below.
const estChooserJob = (overrides: Partial<Job> = {}) =>
  makeJob({ svc: "estimate", kind: "estimate", visits: [makeVisit()], ...overrides });
function renderChooserWithRow(row: "Scope" | "Photos", job = estChooserJob(), readOnly = false) {
  mockJobs = [job];
  const r = render(<QuoteTab job={job} scopeVisit={job.visits[0]} readOnly={readOnly} onSigned={mockOnSigned} />);
  fireEvent.click(screen.getByRole("button", { name: new RegExp("^" + row) }));
  return r;
}

describe("QuoteTab — normal job", () => {
  it("renders the embedded builder with the present primary — and NO scope furniture", () => {
    const job = makeJob();
    mockJobs = [job];
    render(<QuoteTab job={job} scopeVisit={job.visits[0]} readOnly={false} onSigned={mockOnSigned} />);
    // Scope serves the send-to-office flow, which a repair job does not have (Owen, Aug 11:
    // scope headlining every variant "considering in only one of the flows we send it").
    expect(screen.queryByText("Scope")).toBeNull();
    expect(screen.getByText("The price")).toBeTruthy();
    expect(screen.getByText("Present to customer →")).toBeTruthy();
    // No estimate exits on a repair.
    expect(screen.queryByText("Quote it now")).toBeNull();
    expect(screen.queryByText("Send scope to the office")).toBeNull();
  });

  it("the present primary is disabled until something is priced", () => {
    const job = makeJob();
    mockJobs = [job];
    render(<QuoteTab job={job} scopeVisit={job.visits[0]} readOnly={false} onSigned={mockOnSigned} />);
    expect((screen.getByText("Present to customer →") as HTMLButtonElement).disabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The good/better/best opt-in. It is ONE bordered row under the price card — the
// question and what it buys on the left, "Set up →" on the right — instead of a
// muted caption with two loose chips under it. The two opt-ins themselves are
// unchanged; they expand IN FLOW under the row (no floating UI).
// ---------------------------------------------------------------------------

describe("QuoteTab — the customer-choices row", () => {
  // An estimate-kind job carrying lines = the tech's own in-progress DRAFT (the unmount
  // stash writes those) — the one priced shape that stays editable. Priced lines on a
  // WORK job are booked now, and the booked surface has its own describe below.
  const pricedJob = () =>
    makeJob({ svc: "estimate", lines: [{ d: "Flat rate", q: 1, r: 185 }] } as Partial<Job>);

  it("is absent until something is priced — there is nothing to offer options on", () => {
    const job = makeJob();
    mockJobs = [job];
    render(<QuoteTab job={job} scopeVisit={job.visits[0]} readOnly={false} onSigned={mockOnSigned} />);
    expect(screen.queryByText("Give the customer choices?")).toBeNull();
  });

  it("offers + Cheaper / + Premium directly — the actions ARE the row", () => {
    const job = pricedJob();
    mockJobs = [job];
    render(<QuoteTab job={job} scopeVisit={job.visits[0]} readOnly={false} onSigned={mockOnSigned} />);
    expect(screen.getByText("Give the customer choices?")).toBeTruthy();
    // No disclosure in front of two buttons — "Set up →" revealed exactly these and nothing else.
    expect(screen.queryByText("Set up →")).toBeNull();
    expect(screen.getByRole("button", { name: "+ Cheaper" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "+ Premium" })).toBeTruthy();
  });

  it("an opt-in still adds the tier and the row drops that button", () => {
    const job = pricedJob();
    mockJobs = [job];
    render(<QuoteTab job={job} scopeVisit={job.visits[0]} readOnly={false} onSigned={mockOnSigned} />);

    fireEvent.click(screen.getByRole("button", { name: "+ Premium" }));

    // The tier rail appears with the new option selected…
    expect(screen.getByRole("button", { name: /Best/ })).toBeTruthy();
    // …and the row now offers only the tier not yet on.
    expect(screen.queryByRole("button", { name: "+ Premium" })).toBeNull();
    expect(screen.getByRole("button", { name: "+ Cheaper" })).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Where a signed quote lands. The tab used to hand the builder `close`, so the
// customer's signature dismissed the technician out of the job — and in the flow
// this exists for (walk through, price at the door, sign, then DO the work) that
// is the moment the job becomes his. The tab delegates instead; the host lands it.
// ---------------------------------------------------------------------------

describe("QuoteTab — after the customer signs", () => {
  // A tech DRAFT (estimate-kind + lines) — the editable shape that presents and signs.
  const pricedJob = () =>
    makeJob({ svc: "estimate", lines: [{ d: "Flat rate", q: 1, r: 185 }] } as Partial<Job>);

  /** Price → Present → type the name → Accept & sign. */
  async function signIt() {
    fireEvent.click(screen.getByText("Present to customer →"));
    fireEvent.change(screen.getByLabelText(/full name/), { target: { value: "Dana Alvarez" } });
    fireEvent.click(screen.getByText(/^Accept & sign/));
    await vi.waitFor(() => expect(mockSignJobQuote).toHaveBeenCalled());
  }

  it("calls onSigned and does NOT dismiss the sheet", async () => {
    const job = pricedJob();
    mockJobs = [job];
    render(<QuoteTab job={job} scopeVisit={job.visits[0]} readOnly={false} onSigned={mockOnSigned} />);

    await signIt();

    await vi.waitFor(() => expect(mockOnSigned).toHaveBeenCalledTimes(1));
    expect(mockClose).not.toHaveBeenCalled();
  });

  it("stays put when the sign fails — nowhere to land, and the tech can retry", async () => {
    mockSignJobQuote.mockResolvedValue({ ok: false, error: "this job isn't assigned to you" });
    const job = pricedJob();
    mockJobs = [job];
    render(<QuoteTab job={job} scopeVisit={job.visits[0]} readOnly={false} onSigned={mockOnSigned} />);

    await signIt();

    expect(await screen.findByText("this job isn't assigned to you")).toBeTruthy();
    expect(mockOnSigned).not.toHaveBeenCalled();
    expect(mockClose).not.toHaveBeenCalled();
  });

  it("keeps the fallback Done on dismiss — leaving is still leaving", () => {
    const job = makeJob({ status: "done" });
    mockJobs = [job];
    render(<QuoteTab job={job} scopeVisit={job.visits[0]} readOnly={true} onSigned={mockOnSigned} />);

    fireEvent.click(screen.getByText("Done"));
    expect(mockClose).toHaveBeenCalledTimes(1);
    expect(mockOnSigned).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Scope save
// ---------------------------------------------------------------------------

describe("QuoteTab — scope save", () => {
  it("tap → edit → Save writes through setVisitNotes with the visit id", async () => {
    const job = estChooserJob();
    renderChooserWithRow("Scope", job);
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
    const job = estChooserJob();
    renderChooserWithRow("Scope", job);
    fireEvent.click(screen.getByText(/What you saw on site/));
    fireEvent.change(screen.getByLabelText("Scope notes"), { target: { value: "x" } });
    fireEvent.click(screen.getByText("Save scope"));
    expect(await screen.findByText("this job isn't assigned to you")).toBeTruthy();
    expect(screen.getByLabelText("Scope notes")).toBeTruthy();
  });

  it("shows saved scope notes with an Edit affordance", () => {
    const job = estChooserJob({ visits: [makeVisit({ scopeNotes: "40 ft of baseboard" })] });
    renderChooserWithRow("Scope", job);
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
    render(<QuoteTab job={job} scopeVisit={job.visits[0]} readOnly={false} onSigned={mockOnSigned} />);
    expect(screen.getByText("Quote it now")).toBeTruthy();
    expect(screen.getByText("Send scope to the office")).toBeTruthy();
    expect(screen.queryByText("Present to customer →")).toBeNull();
    // The old dead end is gone.
    expect(screen.queryByText(/the office builds the quote$/)).toBeNull();
  });

  it("'Quote it now' reveals the builder + present flow", () => {
    const job = estJob();
    mockJobs = [job];
    render(<QuoteTab job={job} scopeVisit={job.visits[0]} readOnly={false} onSigned={mockOnSigned} />);
    fireEvent.click(screen.getByText("Quote it now"));
    expect(screen.getByText("The price")).toBeTruthy();
    expect(screen.getByText("Present to customer →")).toBeTruthy();
    expect(screen.queryByText("Send scope to the office")).toBeNull();
  });

  it("'Send scope to the office' with nothing written names the problem and opens the editor", () => {
    const job = estJob();
    mockJobs = [job];
    render(<QuoteTab job={job} scopeVisit={job.visits[0]} readOnly={false} onSigned={mockOnSigned} />);
    fireEvent.click(screen.getByText("Send scope to the office"));
    expect(screen.getByText("Write what you saw first — the office quotes from your notes.")).toBeTruthy();
    expect(screen.getByLabelText("Scope notes")).toBeTruthy();
    expect(mockSetVisitNotes).not.toHaveBeenCalled();
  });

  it("a visit carrying scope notes IS sent — quiet confirmation, notes still editable", () => {
    const job = estJob([makeVisit({ scopeNotes: "two doors" })]);
    mockJobs = [job];
    render(<QuoteTab job={job} scopeVisit={job.visits[0]} readOnly={false} onSigned={mockOnSigned} />);
    expect(screen.getByText(/the office builds the quote from your scope/)).toBeTruthy();
    expect(screen.queryByText("Send scope to the office")).toBeNull();
    expect(screen.getByText("Quote it now")).toBeTruthy();
    // Still editable — the notes live behind the Scope row, marked written.
    fireEvent.click(screen.getByRole("button", { name: /^Scope/ }));
    expect(screen.getByText("Edit →")).toBeTruthy();
  });

  it("an already-quoted estimate job goes straight to the builder (no dual exit)", () => {
    const job = makeJob({ svc: "estimate", lines: [{ d: "Repaint hall", q: 1, r: 400 }] });
    mockJobs = [job];
    render(<QuoteTab job={job} scopeVisit={job.visits[0]} readOnly={false} onSigned={mockOnSigned} />);
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
  function renderScanRow(scan: RoomScanAvailability, readOnly = false) {
    mockMeasurementEstimating = "on";
    mockScan = scan;
    return renderChooserWithRow("Photos", estChooserJob(), readOnly);
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
    render(<QuoteTab job={job} scopeVisit={job.visits[0]} readOnly={false} onSigned={mockOnSigned} />);
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
    mockMeasurementEstimating = "unknown";
    mockScan = { status: "ready" };
    renderChooserWithRow("Photos");

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
    mockMeasurementEstimating = "unknown";
    mockScan = { status: "ready" };
    renderChooserWithRow("Photos");
    fireEvent.click(screen.getByRole("button", { name: "Scan a room" }));
    expect(mockPushModal).not.toHaveBeenCalled();
  });

  it("the DEVICE still outranks an unknown gate — a browser is told to open the app", () => {
    mockMeasurementEstimating = "unknown";
    mockScan = { status: "no-native-app" };
    renderChooserWithRow("Photos");
    expect(
      screen.getByText("Open the Mallet iPhone app to scan — a browser cannot reach the LiDAR sensor."),
    ).toBeTruthy();
  });

  it("an unknown gate outranks a CLOSED job — reopening it would not make the scan work", () => {
    mockMeasurementEstimating = "unknown";
    mockScan = { status: "ready" };
    renderChooserWithRow("Photos", estChooserJob({ status: "done", visits: [makeVisit({ status: "done" })] }), true);
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
    const job = estChooserJob({ status: "done", visits: [makeVisit({ scopeNotes: "as found", status: "done" })] });
    mockMeasurementEstimating = "on";
    mockScan = { status: "ready" };
    renderChooserWithRow("Scope", job, true);
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
    const job = estChooserJob({ status: "done", visits: [makeVisit({ scopeNotes: "as found", status: "done" })] });
    mockMeasurementEstimating = "on";
    mockScan = { status: "ready" };
    renderChooserWithRow("Photos", job, true);

    const button = screen.getByRole("button", { name: "Scan a room" });
    expect(button).toHaveProperty("disabled", true);
    expect(screen.getByText("This job is closed — reopen it to scan a room.")).toBeTruthy();

    fireEvent.click(button);
    expect(mockPushModal).not.toHaveBeenCalled();
  });
});


/**
 * THE PRICE SURVIVES LEAVING THE TAB.
 *
 * signQuote was the only way a field-built price reached the server, and it demands a signature —
 * so a technician who priced a repair and then switched to the Job tab, closed the sheet, or had
 * iOS reap the tab lost every line. The builder held them in local React state and nothing else.
 *
 * Saved on UNMOUNT rather than per keystroke: a debounced autosave writes half-typed prices to the
 * job from a moving truck, and leaving the tab is the moment the edit is actually finished.
 */
describe("QuoteTab — the price is saved when the tech leaves", () => {
  // The stash exists for the tech's own DRAFT — estimate-kind lines nobody has committed.
  // A booked/signed job's builder is a change-order surface and stashes add-ons instead.
  const priced = () =>
    makeJob({ svc: "estimate", lines: [{ d: "Flat rate", q: 1, r: 185 }] } as Partial<Job>);

  it("writes the changed lines through the field draft endpoint", () => {
    const job = priced();
    mockJobs = [job];
    const { unmount } = render(
      <QuoteTab job={job} scopeVisit={job.visits[0]} readOnly={false} onSigned={mockOnSigned} />,
    );

    fireEvent.change(screen.getAllByLabelText("Price")[0]!, { target: { value: "250" } });
    unmount();

    expect(mockSaveQuoteDraft).toHaveBeenCalledTimes(1);
    const [jobId, input] = mockSaveQuoteDraft.mock.calls[0] as unknown as [
      string,
      { lines: { description: string; rateCents: number }[] },
    ];
    expect(jobId).toBe(job.id);
    expect(input.lines).toEqual([
      expect.objectContaining({ description: "Flat rate", rateCents: 25000 }),
    ]);
  });

  it("writes NOTHING when the tech only looked at the tab", () => {
    const job = priced();
    mockJobs = [job];
    const { unmount } = render(
      <QuoteTab job={job} scopeVisit={job.visits[0]} readOnly={false} onSigned={mockOnSigned} />,
    );

    unmount();

    // An unchanged price is not an edit — a write here would be a pointless round trip and would
    // stamp the job as touched when it was only read.
    expect(mockSaveQuoteDraft).not.toHaveBeenCalled();
  });

  it("saves a line ADDED through the picker", () => {
    const job = priced();
    mockJobs = [job];
    const { unmount } = render(
      <QuoteTab job={job} scopeVisit={job.visits[0]} readOnly={false} onSigned={mockOnSigned} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "+ Add to the quote" }));
    fireEvent.click(screen.getByText("Custom item"));
    fireEvent.change(screen.getAllByLabelText("Price")[1]!, { target: { value: "95" } });
    unmount();

    const [, input] = mockSaveQuoteDraft.mock.calls[0] as unknown as [
      string,
      { lines: { rateCents: number }[] },
    ];
    expect(input.lines.map((l) => l.rateCents)).toEqual([18500, 9500]);
  });
});


/**
 * THE CHANGE ORDER. A job with `sourceEstimateId` has a SIGNED quote behind it — the price is a
 * document, not a draft. The builder stops offering to rewrite it: sold lines read back fixed,
 * new lines are a change order, and the signature goes through the found-work addendum
 * (signChangeOrder → addAddon + approveFoundWork), which is the approval the customer's own
 * signed sentence requires.
 */
describe("QuoteTab — a sold job takes change orders, not edits", () => {
  const soldJob = (over: Partial<Job> = {}) =>
    makeJob({
      sourceEstimateId: "est-1",
      lines: [{ d: "Diagnostic / trip fee", q: 1, r: 95 }],
      ...over,
    } as Partial<Job>);

  const renderSold = (job = soldJob()) => {
    mockJobs = [job];
    return render(
      <QuoteTab job={job} scopeVisit={job.visits[0]} readOnly={false} onSigned={mockOnSigned} />,
    );
  };

  it("reads the sold document back fixed — no inputs carry the signed price", () => {
    renderSold();
    expect(screen.getByText("Sold — signed")).toBeTruthy();
    expect(screen.getByText("Diagnostic / trip fee")).toBeTruthy();
    // The sold line is a read-back, not an editable row.
    expect(screen.queryByDisplayValue("Diagnostic / trip fee")).toBeNull();
    expect(screen.getByText("Change order")).toBeTruthy();
  });

  it("the primary names the change order and stays down until there is one", () => {
    renderSold();
    const pri = screen.getByText("Present change order →") as HTMLButtonElement;
    expect(pri.disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "+ Add to the quote" }));
    fireEvent.click(screen.getByText("Custom item"));
    fireEvent.change(screen.getByLabelText("Price"), { target: { value: "40" } });
    fireEvent.change(screen.getByPlaceholderText(/part, material/), { target: { value: "Extra shutoff valve" } });

    expect((screen.getByText("Present change order →") as HTMLButtonElement).disabled).toBe(false);
  });

  it("presenting lands on Sign change order, and signing goes through the addendum", async () => {
    renderSold();
    fireEvent.click(screen.getByRole("button", { name: "+ Add to the quote" }));
    fireEvent.click(screen.getByText("Custom item"));
    fireEvent.change(screen.getByLabelText("Price"), { target: { value: "40" } });
    fireEvent.change(screen.getByPlaceholderText(/part, material/), { target: { value: "Extra shutoff valve" } });

    fireEvent.click(screen.getByText("Present change order →"));

    expect(screen.getByText("Sign change order")).toBeTruthy();
    expect(screen.getByText(/Approve & sign — \$40\.00/)).toBeTruthy();
    // The addition against the document it changes.
    expect(screen.getByText("New job total")).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/full name/), { target: { value: "Dana Alvarez" } });
    fireEvent.click(screen.getByText(/Approve & sign/));
    await Promise.resolve();

    expect(mockSignChangeOrder).toHaveBeenCalledTimes(1);
    const [jobId, input] = mockSignChangeOrder.mock.calls[0] as unknown as [
      string,
      { lines: { description: string; rateCents: number }[]; includeAddonDbIds: string[]; signerName: string },
    ];
    expect(jobId).toBe("job-1");
    expect(input.lines).toEqual([{ description: "Extra shutoff valve", rateCents: 4000 }]);
    expect(input.signerName).toBe("Dana Alvarez");
    // The signed quote itself was never re-signed.
    expect(mockSignJobQuote).not.toHaveBeenCalled();
  });

  it("found work already proposed rides the change order", () => {
    renderSold(
      soldJob({
        addons: [{ id: 1, dbId: "ad-1", d: "Extra shutoff valve", q: 1, r: 40, status: "proposed" }],
      } as Partial<Job>),
    );
    expect(screen.getByText(/Extra shutoff valve · waiting for OK/)).toBeTruthy();
    // It counts as the change order, so presenting is live with no typed lines at all.
    expect((screen.getByText("Present change order →") as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByText("Present change order →"));
    fireEvent.change(screen.getByLabelText(/full name/), { target: { value: "Dana Alvarez" } });
    fireEvent.click(screen.getByText(/Approve & sign/));

    const [, input] = mockSignChangeOrder.mock.calls[0] as unknown as [
      string,
      { includeAddonDbIds: string[] },
    ];
    expect(input.includeAddonDbIds).toEqual(["ad-1"]);
  });

  it("leaving without signing stashes the change lines as PROPOSED found work — never a price draft", () => {
    const { unmount } = renderSold();
    fireEvent.click(screen.getByRole("button", { name: "+ Add to the quote" }));
    fireEvent.click(screen.getByText("Custom item"));
    fireEvent.change(screen.getByLabelText("Price"), { target: { value: "40" } });
    fireEvent.change(screen.getByPlaceholderText(/part, material/), { target: { value: "Extra shutoff valve" } });

    unmount();

    expect(mockAddAddonField).toHaveBeenCalledWith("job-1", { d: "Extra shutoff valve", r: 40 });
    // saveQuoteDraft would overwrite the signed document — it must never fire on a sold job.
    expect(mockSaveQuoteDraft).not.toHaveBeenCalled();
  });

  it("hides the document's own machinery — choices and rates belong to the signed quote", () => {
    renderSold();
    fireEvent.click(screen.getByRole("button", { name: "+ Add to the quote" }));
    fireEvent.click(screen.getByText("Custom item"));
    fireEvent.change(screen.getByLabelText("Price"), { target: { value: "40" } });

    expect(screen.queryByText("Give the customer choices?")).toBeNull();
    expect(screen.queryByText("Discount")).toBeNull();
    expect(screen.queryByText("Sales tax")).toBeNull();
  });
});

/**
 * THE BOOKED JOB. Priced lines on a WORK job — the office saved a price ("Create & price it",
 * or the job sheet's Build the price) — are a commitment the customer agreed to on the phone,
 * signature or not. The tech's builder treats it exactly like a sold one: read-back + change
 * orders, never an editable draft. Only the words differ ("Booked", and an approval sentence
 * that does not claim a signature that never happened). The one priced shape that stays
 * editable is the tech's own estimate-kind draft, covered above.
 */
describe("QuoteTab — a BOOKED price takes change orders, not edits", () => {
  const bookedJob = (over: Partial<Job> = {}) =>
    makeJob({
      // svc "service", no sourceEstimateId — the office booked it, nobody signed.
      lines: [{ d: "Water heater swap", q: 1, r: 1850 }],
      ...over,
    } as Partial<Job>);

  const renderBooked = (job = bookedJob()) => {
    mockJobs = [job];
    return render(
      <QuoteTab job={job} scopeVisit={job.visits[0]} readOnly={false} onSigned={mockOnSigned} />,
    );
  };

  it("reads the booked price back fixed under its own word — no editable rows", () => {
    renderBooked();
    expect(screen.getByText("Booked")).toBeTruthy();
    expect(screen.queryByText("Sold — signed")).toBeNull();
    expect(screen.getByText("Water heater swap")).toBeTruthy();
    expect(screen.queryByDisplayValue("Water heater swap")).toBeNull();
    expect(screen.getByText("Change order")).toBeTruthy();
    // The document's own machinery stays with the office, exactly as on a sold job.
    expect(screen.queryByText("Give the customer choices?")).toBeNull();
    expect(screen.queryByText("Discount")).toBeNull();
  });

  it("new work presents as a change order and signs through the addendum — never signQuote", async () => {
    renderBooked();
    fireEvent.click(screen.getByRole("button", { name: "+ Add to the quote" }));
    fireEvent.click(screen.getByText("Custom item"));
    fireEvent.change(screen.getByLabelText("Price"), { target: { value: "40" } });
    fireEvent.change(screen.getByPlaceholderText(/part, material/), { target: { value: "Extra shutoff valve" } });

    fireEvent.click(screen.getByText("Present change order →"));
    expect(screen.getByText("Sign change order")).toBeTruthy();
    // The sentence never claims a prior signature — this job was booked, not signed.
    expect(screen.queryByText(/already signed/)).toBeNull();

    fireEvent.change(screen.getByLabelText(/full name/), { target: { value: "Dana Alvarez" } });
    fireEvent.click(screen.getByText(/Approve & sign/));
    await Promise.resolve();

    expect(mockSignChangeOrder).toHaveBeenCalledTimes(1);
    expect(mockSignJobQuote).not.toHaveBeenCalled();
  });

  it("leaving stashes typed work as PROPOSED found work — saveQuoteDraft must not overwrite the booked price", () => {
    const { unmount } = renderBooked();
    fireEvent.click(screen.getByRole("button", { name: "+ Add to the quote" }));
    fireEvent.click(screen.getByText("Custom item"));
    fireEvent.change(screen.getByLabelText("Price"), { target: { value: "40" } });
    fireEvent.change(screen.getByPlaceholderText(/part, material/), { target: { value: "Extra shutoff valve" } });

    unmount();

    expect(mockAddAddonField).toHaveBeenCalledWith("job-1", { d: "Extra shutoff valve", r: 40 });
    expect(mockSaveQuoteDraft).not.toHaveBeenCalled();
  });
});

/**
 * A CLOSED job's quote tab used to render scope + Done and nothing else — on a job with a signed
 * quote that read as "this job has no quote" (Owen: "this is all I see").
 */
describe("QuoteTab — a closed job reads its quote back", () => {
  it("shows the sold lines, the total, and the honest next step", () => {
    const job = makeJob({
      status: "done",
      sourceEstimateId: "est-1",
      lines: [{ d: "Diagnostic / trip fee", q: 1, r: 95 }],
    } as Partial<Job>);
    mockJobs = [job];
    render(<QuoteTab job={job} scopeVisit={job.visits[0]} readOnly onSigned={mockOnSigned} />);

    expect(screen.getByText("Sold — signed")).toBeTruthy();
    expect(screen.getByText("Diagnostic / trip fee")).toBeTruthy();
    expect(screen.getAllByText("$95.00").length).toBeGreaterThan(0);
    expect(screen.getByText(/Reopen it from the Job tab/)).toBeTruthy();
    // Read-back only: no builder, no add control.
    expect(screen.queryByRole("button", { name: "+ Add to the quote" })).toBeNull();
  });
});


// Owen, Aug 11: "no back button when I hit quote it now." The reveal was one-way — quoteItNow
// flipped true and nothing ever unset it, so the chooser (and the send-to-office path) became
// unreachable without closing the whole sheet.
describe("QuoteTab — the builder has a way back to the chooser", () => {
  const estJob = (overrides: Partial<Job> = {}) =>
    makeJob({ svc: "estimate", kind: "estimate", visits: [makeVisit()], ...overrides });

  it("shows ← Back after 'Quote it now', and it returns to the dual exit", () => {
    const job = estJob();
    mockJobs = [job];
    render(<QuoteTab job={job} scopeVisit={job.visits[0]} readOnly={false} onSigned={mockOnSigned} />);
    fireEvent.click(screen.getByText("Quote it now"));

    const back = screen.getByRole("button", { name: "← Back" });
    fireEvent.click(back);

    expect(screen.getByText("Quote it now")).toBeTruthy();
    expect(screen.getByText("Send scope to the office")).toBeTruthy();
    expect(screen.queryByText("Present to customer →")).toBeNull();
  });

  it("offers no Back on a committed job — the builder is its standing surface", () => {
    // Signed on site: sourceEstimateId set → jobPriceCommitted true.
    const job = estJob({ sourceEstimateId: "est-1" });
    mockJobs = [job];
    render(<QuoteTab job={job} scopeVisit={job.visits[0]} readOnly={false} onSigned={mockOnSigned} />);
    expect(screen.queryByRole("button", { name: "← Back" })).toBeNull();
  });

  it("a resumed draft still offers Back — the tech may switch to sending scope instead", () => {
    const job = estJob({ lines: [{ d: "rough-in", q: 1, r: 100, c: 0 }] });
    mockJobs = [job];
    render(<QuoteTab job={job} scopeVisit={job.visits[0]} readOnly={false} onSigned={mockOnSigned} />);
    // Draft lines resume straight into the builder…
    expect(screen.queryByText("Quote it now")).toBeNull();
    // …but the chooser stays one tap away.
    fireEvent.click(screen.getByRole("button", { name: "← Back" }));
    expect(screen.getByText("Quote it now")).toBeTruthy();
  });
});

// Owen's picked design (Aug 11 mockups): walkthrough = actions first, Scope/Photos as quiet
// level-0 rows beneath; committed job = money only; scope UI exists ONLY where the
// send-to-office flow lives.
describe("QuoteTab — scope follows its flow", () => {
  const estJob = (overrides: Partial<Job> = {}) =>
    makeJob({ svc: "estimate", kind: "estimate", visits: [makeVisit()], ...overrides });

  it("walkthrough: the two actions lead; Scope and Photos are rows beneath them", () => {
    const job = estJob();
    mockJobs = [job];
    render(<QuoteTab job={job} scopeVisit={job.visits[0]} readOnly={false} onSigned={mockOnSigned} />);

    const quoteBtn = screen.getByText("Quote it now");
    const scopeRow = screen.getByRole("button", { name: /^Scope/ });
    // DOM order: the action precedes the row.
    expect(quoteBtn.compareDocumentPosition(scopeRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Photos/ })).toBeTruthy();
    // The old standing section head is gone.
    expect(screen.queryByText("What you saw on site — sizes, access, materials.")).toBeNull();
  });

  it("the Scope row expands in-flow into the editor", () => {
    const job = estJob();
    mockJobs = [job];
    render(<QuoteTab job={job} scopeVisit={job.visits[0]} readOnly={false} onSigned={mockOnSigned} />);

    fireEvent.click(screen.getByRole("button", { name: /^Scope/ }));
    expect(screen.getByText("What you saw on site — sizes, access, materials.")).toBeTruthy();
  });

  it("committed job: money only — no Scope row, no Photos row, no scope card", () => {
    const job = estJob({ sourceEstimateId: "est-1" });
    mockJobs = [job];
    render(<QuoteTab job={job} scopeVisit={job.visits[0]} readOnly={false} onSigned={mockOnSigned} />);

    expect(screen.queryByRole("button", { name: /^Scope/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Photos/ })).toBeNull();
    expect(screen.queryByText("What you saw on site — sizes, access, materials.")).toBeNull();
  });

  it("the builder after 'Quote it now' carries no scope furniture — Back reaches it", () => {
    const job = estJob();
    mockJobs = [job];
    render(<QuoteTab job={job} scopeVisit={job.visits[0]} readOnly={false} onSigned={mockOnSigned} />);

    fireEvent.click(screen.getByText("Quote it now"));
    expect(screen.queryByRole("button", { name: /^Scope/ })).toBeNull();
    expect(screen.getByRole("button", { name: "← Back" })).toBeTruthy();
  });

  it("'Send scope to the office' with nothing written opens the Scope row and names the problem", () => {
    const job = estJob();
    mockJobs = [job];
    render(<QuoteTab job={job} scopeVisit={job.visits[0]} readOnly={false} onSigned={mockOnSigned} />);

    fireEvent.click(screen.getByText("Send scope to the office"));
    // The row expanded straight into the EDITOR — no second tap — and the refusal says why.
    expect(screen.getByLabelText("Scope notes")).toBeTruthy();
    expect(screen.getByText("Write what you saw first — the office quotes from your notes.")).toBeTruthy();
  });
});
