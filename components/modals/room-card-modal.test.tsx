// @vitest-environment jsdom
/**
 * components/modals/room-card-modal.test.tsx
 *
 * Guards RoomCardModalContent (Task 8) — the room card drill-in:
 *  - the four quantity status renderings, incl. "measured N" beside overrides
 *    and NO badges on manual-source rooms
 *  - the quantity editor commits via setRoomQuantity with the right args
 *  - invalid input shows the named error and never calls the store
 *  - create mode saves via addManualRoom, awaits `persisted`, and closes on
 *    success; stays open with an inline error on rejection
 *  - "Remove room" is a two-tap armed delete
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { Job, RoomCard, RoomQuantity } from "@/lib/store/types";

const JOB_ID = "job-1";
const CAPTURE_ID = "room-1";

interface Store {
  roomsByJob: Record<string, RoomCard[]>;
  jobs: Job[];
  setRoomQuantity: ReturnType<typeof vi.fn>;
  setTrimHeight: ReturnType<typeof vi.fn>;
  renameRoom: ReturnType<typeof vi.fn>;
  archiveRoom: ReturnType<typeof vi.fn>;
  addManualRoom: ReturnType<typeof vi.fn>;
  scanRoom: ReturnType<typeof vi.fn>;
  rescanRoom: ReturnType<typeof vi.fn>;
}

let storeState: Store;
let activeModalParams: Record<string, unknown>;
const closeMock = vi.fn();
const pushModalMock = vi.fn();
const useJobRoomsMock = vi.fn();
const useRoomScanAvailabilityMock = vi.fn();

vi.mock("@/lib/store/app-store", () => ({
  useActiveModal: () => ({ id: "room-card", params: activeModalParams }),
  useCloseModal: () => closeMock,
  usePushModal: () => pushModalMock,
  useAppStore: (selector: (s: Store) => unknown) => selector(storeState),
}));

vi.mock("@/features/measurements/use-job-rooms", () => ({
  useJobRooms: (...args: unknown[]) => useJobRoomsMock(...args),
}));

// These tests exercise the OFFICE behavior (quantity editing) — the tech's
// read-only quantity rows are covered separately below via mockRoleRef.
const mockRoleRef = { role: "owner" as "owner" | "office" | "tech" };
vi.mock("@/features/identity/hooks", () => ({
  useMe: () => ({ data: { role: mockRoleRef.role, userId: "user-1" }, isLoading: false }),
}));

vi.mock("@/lib/native/room-scan", async () => {
  const actual = await vi.importActual<typeof import("@/lib/native/room-scan")>("@/lib/native/room-scan");
  return {
    ...actual,
    useRoomScanAvailability: () => useRoomScanAvailabilityMock(),
  };
});

import { RoomCardModalContent, quantityDisplay, parseQuantityInput, formatQuantity } from "./room-card-modal";
import { RoomScanPayloadError, RoomScanCaptureError } from "@/lib/native/room-scan";

function job(overrides: Partial<Job> = {}): Job {
  return { id: JOB_ID, title: "Repaint job", leadId: "l1", svc: null, origin: "manual", addr: "", phone: "", status: "unscheduled", archived: false, lines: [], addons: [], photos: [], notes: "", acts: [], visits: [], ...overrides } as Job;
}

function quantity(overrides: Partial<RoomQuantity> = {}): RoomQuantity {
  return { kind: "walls_sqft", value: 562, derivedValue: 560, status: "derived", heightIn: null, ...overrides };
}

function room(overrides: Partial<RoomCard> = {}): RoomCard {
  return {
    id: CAPTURE_ID,
    jobId: JOB_ID,
    roomName: "Living room",
    source: "roomplan_v1",
    capturedAt: "2026-07-29T00:00:00.000Z",
    quantities: [quantity()],
    deductions: [],
    walls: [],
    netWallsSqft: null,
    ...overrides,
  };
}

beforeEach(() => {
  mockRoleRef.role = "owner";
  activeModalParams = { captureId: CAPTURE_ID, jobId: JOB_ID };
  closeMock.mockReset();
  pushModalMock.mockReset();
  useJobRoomsMock.mockReset();
  useJobRoomsMock.mockReturnValue({ isLoading: false });
  useRoomScanAvailabilityMock.mockReset();
  // A browser is the honest default for this suite — the office opens room cards on a desktop.
  useRoomScanAvailabilityMock.mockReturnValue({ status: "no-native-app" });
  storeState = {
    roomsByJob: { [JOB_ID]: [room()] },
    jobs: [job()],
    setRoomQuantity: vi.fn(),
    setTrimHeight: vi.fn(),
    renameRoom: vi.fn(),
    archiveRoom: vi.fn(),
    addManualRoom: vi.fn(),
    scanRoom: vi.fn(),
    rescanRoom: vi.fn(),
  };
});

// ---------------------------------------------------------------------------
// formatQuantity / parseQuantityInput — pure helpers
// ---------------------------------------------------------------------------

describe("formatQuantity", () => {
  it("formats sqft/lnft to 1 decimal", () => {
    expect(formatQuantity(562, "sqft")).toBe("562.0");
    expect(formatQuantity(12.25, "lnft")).toBe("12.3");
  });

  it("formats counts as whole numbers", () => {
    expect(formatQuantity(2, "count")).toBe("2");
  });
});

describe("parseQuantityInput", () => {
  it("accepts a valid decimal for sqft", () => {
    expect(parseQuantityInput("12.5", "sqft")).toEqual({ ok: true, value: 12.5 });
  });

  it("rejects non-numeric input, naming the value", () => {
    expect(parseQuantityInput("2..4", "sqft")).toEqual({ ok: false, error: `"2..4" is not a number.` });
  });

  it("rejects negative values", () => {
    const result = parseQuantityInput("-3", "sqft");
    expect(result.ok).toBe(false);
  });

  it("rejects a non-integer count", () => {
    const result = parseQuantityInput("2.5", "count");
    expect(result.ok).toBe(false);
  });

  it("treats empty input as a no-op", () => {
    expect(parseQuantityInput("  ", "sqft")).toEqual({ ok: "empty" });
  });
});

// ---------------------------------------------------------------------------
// quantityDisplay — the status law
// ---------------------------------------------------------------------------

describe("quantityDisplay", () => {
  it("derived: plain value, no badge", () => {
    const d = quantityDisplay(quantity({ status: "derived", value: null, derivedValue: 560 }), "roomplan_v1", "sqft");
    expect(d).toEqual({ value: "560.0", valueIsHint: false, badge: null, measured: null });
  });

  it("override on a scan room: edited badge + measured original beside it", () => {
    const d = quantityDisplay(quantity({ status: "override", value: 600, derivedValue: 560 }), "roomplan_v1", "sqft");
    expect(d.badge).toEqual({ tone: "blue", text: "edited" });
    expect(d.measured).toBe("measured 560.0");
    expect(d.value).toBe("600.0");
  });

  it("confirmed on a scan room with no derived value: green confirmed badge", () => {
    const d = quantityDisplay(quantity({ status: "confirmed", value: 4, derivedValue: null }), "roomplan_v1", "count");
    expect(d.badge).toEqual({ tone: "green", text: "confirmed" });
  });

  it("confirmed on a scan room WITH a derived value: no badge (not the vaulted case)", () => {
    const d = quantityDisplay(quantity({ status: "confirmed", value: 560, derivedValue: 560 }), "roomplan_v1", "sqft");
    expect(d.badge).toBeNull();
  });

  it("needs_confirm: amber Confirm badge + Add hint", () => {
    const d = quantityDisplay(quantity({ status: "needs_confirm", value: null, derivedValue: null }), "roomplan_v1", "sqft");
    expect(d.badge).toEqual({ tone: "amber", text: "Confirm" });
    expect(d.value).toBe("Add");
    expect(d.valueIsHint).toBe(true);
  });

  it("needs_confirm WITH a suggestion (trim conventions): the suggestion as a muted hint + Confirm badge, never a plain fact", () => {
    const d = quantityDisplay(quantity({ status: "needs_confirm", value: null, derivedValue: 29.3 }), "roomplan_v1", "lnft");
    expect(d.badge).toEqual({ tone: "amber", text: "Confirm" });
    expect(d.value).toBe("29.3");
    expect(d.valueIsHint).toBe(true);
  });

  it("manual-source rooms never show a badge, even when status is override", () => {
    const d = quantityDisplay(quantity({ status: "override", value: 600, derivedValue: null }), "manual", "sqft");
    expect(d.badge).toBeNull();
    expect(d.measured).toBeNull();
  });

  it("manual-source rooms never show a badge, even though confirmed+null-derived would normally badge", () => {
    const d = quantityDisplay(quantity({ status: "confirmed", value: 100, derivedValue: null }), "manual", "sqft");
    expect(d.badge).toBeNull();
  });

  it("manual-source rooms never show a badge, even when status is needs_confirm — plain rendering, not Confirm/Add", () => {
    const d = quantityDisplay(quantity({ status: "needs_confirm", value: 100, derivedValue: null }), "manual", "sqft");
    expect(d.badge).toBeNull();
    expect(d.measured).toBeNull();
    expect(d.value).toBe("100.0");
    expect(d.valueIsHint).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// View mode — rendering + commit paths
// ---------------------------------------------------------------------------

describe("RoomCardModalContent — view mode", () => {
  it("renders the room name as the sheet head and the source pill + job name in the meta", () => {
    render(<RoomCardModalContent />);
    expect(screen.getByRole("heading", { name: "Living room" })).toBeTruthy();
    expect(screen.getByText(/Scanned/)).toBeTruthy();
    expect(screen.getByText("Repaint job")).toBeTruthy();
  });

  it("shows 'Manual' as the source pill for a manual room", () => {
    storeState.roomsByJob[JOB_ID] = [room({ source: "manual" })];
    render(<RoomCardModalContent />);
    expect(screen.getByText("Manual")).toBeTruthy();
  });

  it("renders no .sheet-pri primary — this is a record viewer, editing is in-row", () => {
    const { container } = render(<RoomCardModalContent />);
    expect(container.querySelector(".sheet-pri")).toBeNull();
  });

  it("offers a re-scan control only for roomplan_v1 rooms", () => {
    render(<RoomCardModalContent />);
    expect(screen.getByRole("button", { name: "Re-scan room" })).toBeTruthy();
  });

  it("does not offer a re-scan control for a manual room", () => {
    storeState.roomsByJob[JOB_ID] = [room({ source: "manual" })];
    render(<RoomCardModalContent />);
    expect(screen.queryByRole("button", { name: "Re-scan room" })).toBeNull();
  });

  it("commits a typed value on blur via setRoomQuantity", () => {
    render(<RoomCardModalContent />);
    fireEvent.click(screen.getByRole("button", { name: /^Walls \(sq ft\)/ }));
    const input = screen.getByLabelText("Walls (sq ft)");
    fireEvent.change(input, { target: { value: "600" } });
    fireEvent.blur(input);
    expect(storeState.setRoomQuantity).toHaveBeenCalledWith(JOB_ID, CAPTURE_ID, "walls_sqft", 600);
  });

  it("commits a typed value on Enter", () => {
    render(<RoomCardModalContent />);
    fireEvent.click(screen.getByRole("button", { name: /^Walls \(sq ft\)/ }));
    const input = screen.getByLabelText("Walls (sq ft)");
    fireEvent.change(input, { target: { value: "600" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(storeState.setRoomQuantity).toHaveBeenCalledWith(JOB_ID, CAPTURE_ID, "walls_sqft", 600);
  });

  it("invalid input shows the named error and keeps the row open without calling the store", () => {
    render(<RoomCardModalContent />);
    fireEvent.click(screen.getByRole("button", { name: /^Walls \(sq ft\)/ }));
    const input = screen.getByLabelText("Walls (sq ft)");
    fireEvent.change(input, { target: { value: "2..4" } });
    fireEvent.blur(input);
    expect(screen.getByText('"2..4" is not a number.')).toBeTruthy();
    expect(storeState.setRoomQuantity).not.toHaveBeenCalled();
    // Row stays open — the input is still in the document.
    expect(screen.getByLabelText("Walls (sq ft)")).toBeTruthy();
  });

  it("empty input on blur closes the row without calling the store", () => {
    render(<RoomCardModalContent />);
    fireEvent.click(screen.getByRole("button", { name: /^Walls \(sq ft\)/ }));
    const input = screen.getByLabelText("Walls (sq ft)");
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(storeState.setRoomQuantity).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Walls (sq ft)")).toBeNull();
  });

  it("renames the room on blur via renameRoom", () => {
    render(<RoomCardModalContent />);
    fireEvent.click(screen.getByText("Room name"));
    const input = screen.getByLabelText("Room name");
    fireEvent.change(input, { target: { value: "Primary bedroom" } });
    fireEvent.blur(input);
    expect(storeState.renameRoom).toHaveBeenCalledWith(JOB_ID, CAPTURE_ID, "Primary bedroom");
  });

  it("Remove room is a two-tap armed delete", () => {
    render(<RoomCardModalContent />);
    const removeBtn = screen.getByText("Remove room");
    fireEvent.click(removeBtn);
    expect(storeState.archiveRoom).not.toHaveBeenCalled();
    expect(screen.getByText(/Tap again/)).toBeTruthy();
    fireEvent.click(screen.getByText(/Tap again/));
    expect(storeState.archiveRoom).toHaveBeenCalledWith(JOB_ID, CAPTURE_ID);
    expect(closeMock).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Create mode
// ---------------------------------------------------------------------------

// THE SCAN ASKS A QUESTION ONLY THE FIELD CAN ANSWER, so the field has to be able to answer it.
//
// The rows used to be read-only for a tech, on the reasoning that resolving a number into the
// record is desk work. But baseboard and crown arrive needing confirmation, and a soffit arrives
// with no suggestion at all, precisely because trim existence is not observable from the geometry
// — derive-painting's own law is that a bathroom with cove base and no crown must never show
// crown as fact. The person who can see the cove base is the one holding the phone.
//
// The result was a tech who could rename the capture and archive the whole room, but could not
// tap the baseboard row. Owen hit it on the first real bathroom scan: "i cant click down on any
// of them or edit them". The ASSIGNMENT gate still applies, server-side.
describe("RoomCardModalContent — view mode, TECH role", () => {
  beforeEach(() => {
    mockRoleRef.role = "tech";
  });

  it("opens the editor on the row a tech taps", () => {
    render(<RoomCardModalContent />);
    fireEvent.click(screen.getByRole("button", { name: /^Walls \(sq ft\)/ }));
    expect(screen.getByLabelText("Walls (sq ft)")).toBeTruthy();
  });

  it("commits the number the tech types", () => {
    render(<RoomCardModalContent />);
    fireEvent.click(screen.getByRole("button", { name: /^Walls \(sq ft\)/ }));
    const field = screen.getByLabelText("Walls (sq ft)");
    fireEvent.change(field, { target: { value: "312" } });
    fireEvent.blur(field);
    expect(storeState.setRoomQuantity).toHaveBeenCalled();
  });

  it("keeps the room name editable and the remove control live", () => {
    render(<RoomCardModalContent />);
    fireEvent.click(screen.getByText("Room name"));
    expect(screen.getByLabelText("Room name")).toBeTruthy();
    expect(screen.getByText("Remove room")).toBeTruthy();
  });
});

describe("RoomCardModalContent — create mode", () => {
  beforeEach(() => {
    activeModalParams = { jobId: JOB_ID };
  });

  it("shows the name field and all six quantity fields with an Add room primary", () => {
    render(<RoomCardModalContent />);
    expect(screen.getByLabelText("Room name")).toBeTruthy();
    expect(screen.getByLabelText("Walls (sq ft)")).toBeTruthy();
    expect(screen.getByLabelText("Windows")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add room" })).toBeTruthy();
  });

  it("saves via addManualRoom and closes on success", async () => {
    storeState.addManualRoom.mockReturnValue({
      room: room({ id: "new-room" }),
      persisted: Promise.resolve(room({ id: "new-room" })),
    });
    render(<RoomCardModalContent />);
    fireEvent.change(screen.getByLabelText("Room name"), { target: { value: "Kitchen" } });
    fireEvent.change(screen.getByLabelText("Walls (sq ft)"), { target: { value: "300" } });
    fireEvent.click(screen.getByRole("button", { name: "Add room" }));

    await waitFor(() => expect(closeMock).toHaveBeenCalled());
    expect(storeState.addManualRoom).toHaveBeenCalledWith(
      JOB_ID,
      "Kitchen",
      expect.arrayContaining([{ kind: "walls_sqft", value: 300 }]),
    );
  });

  it("stays open and shows an inline error when the save rejects", async () => {
    storeState.addManualRoom.mockReturnValue({
      room: room({ id: "new-room" }),
      persisted: Promise.reject(new Error("boom")),
    });
    render(<RoomCardModalContent />);
    fireEvent.change(screen.getByLabelText("Room name"), { target: { value: "Kitchen" } });
    fireEvent.click(screen.getByRole("button", { name: "Add room" }));

    await waitFor(() => expect(screen.getByText(/Couldn't save this room/)).toBeTruthy());
    expect(closeMock).not.toHaveBeenCalled();
  });

  it("does not call addManualRoom when a quantity field is invalid", () => {
    render(<RoomCardModalContent />);
    fireEvent.change(screen.getByLabelText("Room name"), { target: { value: "Kitchen" } });
    fireEvent.change(screen.getByLabelText("Walls (sq ft)"), { target: { value: "2..4" } });
    fireEvent.click(screen.getByRole("button", { name: "Add room" }));

    expect(screen.getByText('"2..4" is not a number.')).toBeTruthy();
    expect(storeState.addManualRoom).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// View mode — re-scan row, three states. The old unavailable branch printed
// "Re-scan replaces these numbers and clears edits" — describing an action the
// reader had no way to start, and never saying they couldn't. Now the control is
// there, disabled, with the reason.
// ---------------------------------------------------------------------------

describe("RoomCardModalContent — view mode rescan row", () => {
  it("state 3 — disabled in a browser, naming the app rather than the device", () => {
    useRoomScanAvailabilityMock.mockReturnValue({ status: "no-native-app" });
    render(<RoomCardModalContent />);
    const button = screen.getByRole("button", { name: "Re-scan room" });

    expect(button).toHaveProperty("disabled", true);
    expect(
      screen.getByText("Open the Mallet iPhone app to scan — a browser cannot reach the LiDAR sensor."),
    ).toBeTruthy();
    expect(screen.queryByText(/iPhone Pro or iPad Pro/)).toBeNull();
  });

  it("state 2 — disabled without LiDAR, naming the device", () => {
    useRoomScanAvailabilityMock.mockReturnValue({ status: "no-lidar" });
    render(<RoomCardModalContent />);
    const button = screen.getByRole("button", { name: "Re-scan room" });

    expect(button).toHaveProperty("disabled", true);
    expect(
      screen.getByText(
        "This device reports no LiDAR sensor — room scanning needs an iPhone Pro or iPad Pro.",
      ),
    ).toBeTruthy();
  });

  it.each(["no-lidar", "no-native-app"] as const)(
    "a %s re-scan control cannot be armed or fired, and announces its reason",
    (status) => {
      useRoomScanAvailabilityMock.mockReturnValue({ status });
      render(<RoomCardModalContent />);
      const button = screen.getByRole("button", { name: "Re-scan room" });

      fireEvent.click(button);
      fireEvent.click(button);
      expect(storeState.rescanRoom).not.toHaveBeenCalled();
      // Never arms: the two-tap confirmation copy belongs to the live control only.
      expect(screen.queryByText(/tap again/i)).toBeNull();

      const reasonId = button.getAttribute("aria-describedby");
      expect(reasonId).toBeTruthy();
      expect(document.getElementById(reasonId as string)?.textContent).toBeTruthy();
    },
  );

  it("keeps the disabled control on the room card's .linklike shape, not a .btn", () => {
    useRoomScanAvailabilityMock.mockReturnValue({ status: "no-lidar" });
    const { container } = render(<RoomCardModalContent />);

    expect(container.querySelector("button.linklike.scanbtn")).toBeTruthy();
    expect(container.querySelector("button.btn.scanbtn")).toBeNull();
  });

  it("does not show any rescan row for a manual room even when scanning is available", () => {
    useRoomScanAvailabilityMock.mockReturnValue({ status: "ready" });
    storeState.roomsByJob[JOB_ID] = [room({ source: "manual" })];
    render(<RoomCardModalContent />);

    expect(screen.queryByText("Re-scan room")).toBeNull();
  });

  it("state 1 — becomes a live two-tap armed control when scanning is ready", () => {
    useRoomScanAvailabilityMock.mockReturnValue({ status: "ready" });
    render(<RoomCardModalContent />);
    const button = screen.getByRole("button", { name: "Re-scan room" });

    expect(button).toHaveProperty("disabled", false);
    expect(button.getAttribute("aria-describedby")).toBeNull();
  });

  it("arms on first tap, fires rescanRoom on second tap, and re-opens on the new capture id", async () => {
    useRoomScanAvailabilityMock.mockReturnValue({ status: "ready" });
    storeState.rescanRoom.mockResolvedValue(room({ id: "room-2" }));
    render(<RoomCardModalContent />);

    fireEvent.click(screen.getByText("Re-scan room"));
    expect(storeState.rescanRoom).not.toHaveBeenCalled();
    expect(screen.getByText(/Replaces these numbers and clears edits/)).toBeTruthy();

    fireEvent.click(screen.getByText(/Replaces these numbers and clears edits/));
    await waitFor(() => expect(storeState.rescanRoom).toHaveBeenCalledWith(JOB_ID, CAPTURE_ID, "Living room"));

    await waitFor(() => expect(closeMock).toHaveBeenCalled());
    expect(pushModalMock).toHaveBeenCalledWith("room-card", { captureId: "room-2", jobId: JOB_ID });
  });

  it("disarms silently (no error) when the native scan is cancelled", async () => {
    useRoomScanAvailabilityMock.mockReturnValue({ status: "ready" });
    storeState.rescanRoom.mockResolvedValue(null);
    render(<RoomCardModalContent />);

    fireEvent.click(screen.getByText("Re-scan room"));
    fireEvent.click(screen.getByText(/Replaces these numbers and clears edits/));

    await waitFor(() => expect(screen.getByText("Re-scan room")).toBeTruthy());
    expect(closeMock).not.toHaveBeenCalled();
    expect(pushModalMock).not.toHaveBeenCalled();
    expect(screen.queryByText(/unreadable data/)).toBeNull();
  });

  it("shows the named payload-error copy and disarms on RoomScanPayloadError", async () => {
    useRoomScanAvailabilityMock.mockReturnValue({ status: "ready" });
    storeState.rescanRoom.mockRejectedValue(new RoomScanPayloadError("geometry", new Error("bad json")));
    render(<RoomCardModalContent />);

    fireEvent.click(screen.getByText("Re-scan room"));
    fireEvent.click(screen.getByText(/Replaces these numbers and clears edits/));

    await waitFor(() =>
      expect(screen.getByText("The scan returned unreadable data. Scan again.")).toBeTruthy(),
    );
    expect(screen.getByText("Re-scan room")).toBeTruthy();
    expect(closeMock).not.toHaveBeenCalled();
  });

  it("capture-phase failure (RoomScanCaptureError) surfaces the native message verbatim, not the connection copy", async () => {
    useRoomScanAvailabilityMock.mockReturnValue({ status: "ready" });
    storeState.rescanRoom.mockRejectedValue(
      new RoomScanCaptureError(new Error("The scan didn't capture a floor — walk the room's perimeter and scan again.")),
    );
    render(<RoomCardModalContent />);

    fireEvent.click(screen.getByText("Re-scan room"));
    fireEvent.click(screen.getByText(/Replaces these numbers and clears edits/));

    await waitFor(() =>
      expect(
        screen.getByText("The scan didn't capture a floor — walk the room's perimeter and scan again."),
      ).toBeTruthy(),
    );
    expect(screen.queryByText(/Couldn't save this scan/)).toBeNull();
    expect(closeMock).not.toHaveBeenCalled();
  });

  it("ingest-phase failure (generic Error from the mutate call) still shows the connection copy", async () => {
    useRoomScanAvailabilityMock.mockReturnValue({ status: "ready" });
    storeState.rescanRoom.mockRejectedValue(new Error("network down"));
    render(<RoomCardModalContent />);

    fireEvent.click(screen.getByText("Re-scan room"));
    fireEvent.click(screen.getByText(/Replaces these numbers and clears edits/));

    await waitFor(() =>
      expect(screen.getByText(/Couldn't save this scan/)).toBeTruthy(),
    );
  });
});

// ---------------------------------------------------------------------------
// Scan mode — { jobId, mode: "scan" }
// ---------------------------------------------------------------------------

describe("RoomCardModalContent — scan mode", () => {
  beforeEach(() => {
    activeModalParams = { jobId: JOB_ID, mode: "scan" };
  });

  it("shows the name field and ONE 'Start scanning' primary — no quantity fields", () => {
    render(<RoomCardModalContent />);
    expect(screen.getByLabelText("Room name")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start scanning" })).toBeTruthy();
    expect(screen.queryByLabelText("Walls (sq ft)")).toBeNull();
  });

  it("requires a room name before scanning — does not call scanRoom", () => {
    render(<RoomCardModalContent />);
    fireEvent.click(screen.getByRole("button", { name: "Start scanning" }));

    expect(screen.getByText("Name this room before scanning.")).toBeTruthy();
    expect(storeState.scanRoom).not.toHaveBeenCalled();
  });

  it("calls scanRoom with the trimmed name and re-opens the card on the new capture", async () => {
    storeState.scanRoom.mockResolvedValue(room({ id: "room-9", roomName: "Kitchen" }));
    render(<RoomCardModalContent />);

    fireEvent.change(screen.getByLabelText("Room name"), { target: { value: "  Kitchen  " } });
    fireEvent.click(screen.getByRole("button", { name: "Start scanning" }));

    await waitFor(() => expect(storeState.scanRoom).toHaveBeenCalledWith(JOB_ID, "Kitchen"));
    await waitFor(() => expect(closeMock).toHaveBeenCalled());
    expect(pushModalMock).toHaveBeenCalledWith("room-card", { captureId: "room-9", jobId: JOB_ID });
  });

  it("keeps the form open with no error when the scan is cancelled", async () => {
    storeState.scanRoom.mockResolvedValue(null);
    render(<RoomCardModalContent />);

    fireEvent.change(screen.getByLabelText("Room name"), { target: { value: "Kitchen" } });
    fireEvent.click(screen.getByRole("button", { name: "Start scanning" }));

    await waitFor(() => expect(storeState.scanRoom).toHaveBeenCalled());
    expect(closeMock).not.toHaveBeenCalled();
    expect(pushModalMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Room name")).toBeTruthy();
    expect(screen.queryByText(/unreadable data/)).toBeNull();
  });

  it("shows the named payload-error copy when the scan returns unreadable data", async () => {
    storeState.scanRoom.mockRejectedValue(new RoomScanPayloadError("rawPayload", new Error("bad json")));
    render(<RoomCardModalContent />);

    fireEvent.change(screen.getByLabelText("Room name"), { target: { value: "Kitchen" } });
    fireEvent.click(screen.getByRole("button", { name: "Start scanning" }));

    await waitFor(() =>
      expect(screen.getByText("The scan returned unreadable data. Scan again.")).toBeTruthy(),
    );
    expect(closeMock).not.toHaveBeenCalled();
  });

  it("capture-phase failure (RoomScanCaptureError) surfaces the native message verbatim, not the connection copy", async () => {
    storeState.scanRoom.mockRejectedValue(new RoomScanCaptureError(new Error("A room scan is already open.")));
    render(<RoomCardModalContent />);

    fireEvent.change(screen.getByLabelText("Room name"), { target: { value: "Kitchen" } });
    fireEvent.click(screen.getByRole("button", { name: "Start scanning" }));

    await waitFor(() => expect(screen.getByText("A room scan is already open.")).toBeTruthy());
    expect(screen.queryByText(/Couldn't save this scan/)).toBeNull();
    expect(closeMock).not.toHaveBeenCalled();
  });

  it("ingest-phase failure (generic Error from the mutate call) still shows the connection copy, form stays open", async () => {
    storeState.scanRoom.mockRejectedValue(new Error("network down"));
    render(<RoomCardModalContent />);

    fireEvent.change(screen.getByLabelText("Room name"), { target: { value: "Kitchen" } });
    fireEvent.click(screen.getByRole("button", { name: "Start scanning" }));

    await waitFor(() => expect(screen.getByText(/Couldn't save this scan/)).toBeTruthy());
    expect(closeMock).not.toHaveBeenCalled();
  });
});


/**
 * THE LOAD BEAT. "This room is no longer available" was shown while the rooms read was still in
 * flight — a false claim about a room that was merely loading. The wait and the absence are
 * different facts and get different screens.
 */
describe("RoomCardModalContent — a room still loading is not 'removed'", () => {
  it("waits while the rooms query is in flight", () => {
    activeModalParams = { jobId: JOB_ID, captureId: "cap-missing" };
    useJobRoomsMock.mockReturnValue({ isLoading: true });
    render(<RoomCardModalContent />);
    expect(screen.queryByText(/no longer available/)).toBeNull();
  });

  it("says removed only once the read has settled without it", () => {
    activeModalParams = { jobId: JOB_ID, captureId: "cap-missing" };
    useJobRoomsMock.mockReturnValue({ isLoading: false });
    render(<RoomCardModalContent />);
    expect(screen.getByText(/no longer available/)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// SOFFITS. The scanner cannot see one — RoomPlan reports walls, the floor and openings, and a boxed
// bulkhead is none of them. So the row exists on every room and is always the painter's own number.
// ---------------------------------------------------------------------------

describe("the soffit row", () => {
  const withSoffit = (value: number | null) =>
    room({
      quantities: [
        quantity(),
        quantity({ kind: "soffit_sqft", value, derivedValue: null, status: value == null ? "needs_confirm" : "confirmed" }),
        quantity({ kind: "crown_lnft", value: null, derivedValue: 46, status: "needs_confirm" }),
      ],
    });

  it("asks to be added rather than showing a measured-looking zero", () => {
    storeState.roomsByJob[JOB_ID] = [withSoffit(null)];
    render(<RoomCardModalContent />);
    const row = screen.getByText("Soffit / bulkhead (sq ft)").closest("div");
    expect(row?.textContent).toContain("Add");
  });

  it("warns that a soffit breaks the crown suggestion, where the suggestion is accepted", () => {
    // Crown is offered as the FLOOR perimeter on a flat-ceiling convention. A soffit is exactly the
    // case where the ceiling outline is not the floor's.
    storeState.roomsByJob[JOB_ID] = [withSoffit(42)];
    render(<RoomCardModalContent />);
    fireEvent.click(screen.getByRole("button", { name: /^Crown \(ln ft\)/ }));
    expect(screen.getByText(/not simply the floor perimeter/)).toBeTruthy();
  });

  it("says nothing about crown when the room has no soffit", () => {
    storeState.roomsByJob[JOB_ID] = [withSoffit(null)];
    render(<RoomCardModalContent />);
    fireEvent.click(screen.getByRole("button", { name: /^Crown \(ln ft\)/ }));
    expect(screen.queryByText(/not simply the floor perimeter/)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// THE TWO ANSWERS A TRIM ROW HAS. Accepting the calculated perimeter used to mean noticing the
// number was already in the box and pressing Enter; recording "this room has no crown" meant
// knowing to type a zero. Neither reads as an option, so both are buttons.
// ---------------------------------------------------------------------------

describe("taking or refusing a trim calculation", () => {
  const trimRoom = () =>
    room({
      quantities: [
        quantity(),
        quantity({ kind: "crown_lnft", value: null, derivedValue: 46, status: "needs_confirm" }),
        quantity({ kind: "baseboard_lnft", value: null, derivedValue: 38.4, status: "needs_confirm" }),
      ],
    });

  it("offers the measured perimeter as a named action carrying its number", () => {
    storeState.roomsByJob[JOB_ID] = [trimRoom()];
    render(<RoomCardModalContent />);
    fireEvent.click(screen.getByRole("button", { name: /^Crown \(ln ft\)/ }));
    expect(screen.getByRole("button", { name: "Use measured 46.0" })).toBeTruthy();
  });

  it("commits that number when it is taken", () => {
    storeState.roomsByJob[JOB_ID] = [trimRoom()];
    render(<RoomCardModalContent />);
    fireEvent.click(screen.getByRole("button", { name: /^Crown \(ln ft\)/ }));
    fireEvent.click(screen.getByRole("button", { name: "Use measured 46.0" }));
    expect(storeState.setRoomQuantity).toHaveBeenCalledWith(JOB_ID, CAPTURE_ID, "crown_lnft", 46);
  });

  it("offers None for a room that simply has no crown", () => {
    // A bathroom with rubber cove base and no crown: the honest answer is zero, and it must be one
    // tap rather than knowledge that typing 0 works.
    storeState.roomsByJob[JOB_ID] = [trimRoom()];
    render(<RoomCardModalContent />);
    fireEvent.click(screen.getByRole("button", { name: /^Crown \(ln ft\)/ }));
    expect(screen.getByRole("button", { name: "None in this room" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "None in this room" }));
    // A CONFIRMED zero, not an unanswered row — so it stops asking and never prices.
    expect(storeState.setRoomQuantity).toHaveBeenCalledWith(JOB_ID, CAPTURE_ID, "crown_lnft", 0);
  });

  it("does NOT offer None on a measured kind — walls are not a thing you have none of", () => {
    storeState.roomsByJob[JOB_ID] = [trimRoom()];
    render(<RoomCardModalContent />);
    fireEvent.click(screen.getByRole("button", { name: /^Walls \(sq ft\)/ }));
    expect(screen.queryByRole("button", { name: "None in this room" })).toBeNull();
  });

  it("offers None on the soffit row, which is the commonest answer", () => {
    storeState.roomsByJob[JOB_ID] = [
      room({
        quantities: [
          quantity(),
          quantity({ kind: "soffit_sqft", value: null, derivedValue: null, status: "needs_confirm" }),
        ],
      }),
    ];
    render(<RoomCardModalContent />);
    fireEvent.click(screen.getByRole("button", { name: /^Soffit \/ bulkhead/ }));
    expect(screen.getByRole("button", { name: "None in this room" })).toBeTruthy();
    // and nothing to "use" — the scanner never measured one
    expect(screen.queryByRole("button", { name: /^Use measured/ })).toBeNull();
  });
});

/**
 * HOW TALL THE TRIM IS.
 *
 * The scanner reports a perimeter, so trim has only ever been a length — and a length is not the
 * work: 38.4 feet of 3¼" colonial base and 38.4 feet of 7" craftsman base are the same number and
 * a different job. The height is TYPED rather than picked, because real millwork runs 2¼", 3¼",
 * 4", 5¼", 7", and plenty of commercial work is a 4" rubber cove that matches no preset list.
 */
describe("trim height", () => {
  const trimRoom = (over: Partial<RoomQuantity> = {}) =>
    room({
      quantities: [
        quantity(),
        quantity({ kind: "baseboard_lnft", value: 38.4, derivedValue: 38.4, status: "confirmed", ...over }),
        quantity({ kind: "crown_lnft", value: 42, derivedValue: 42, status: "confirmed" }),
      ],
    });

  const openBaseboard = () => {
    render(<RoomCardModalContent />);
    fireEvent.click(screen.getByRole("button", { name: /^Baseboard \(ln ft\)/ }));
  };

  it("offers a height field on a run", () => {
    storeState.roomsByJob[JOB_ID] = [trimRoom()];
    openBaseboard();
    expect(screen.getByLabelText("Height (inches)")).toBeTruthy();
  });

  it("offers one on crown too", () => {
    storeState.roomsByJob[JOB_ID] = [trimRoom()];
    render(<RoomCardModalContent />);
    fireEvent.click(screen.getByRole("button", { name: /^Crown \(ln ft\)/ }));
    expect(screen.getByLabelText("Height (inches)")).toBeTruthy();
  });

  it("offers NONE on a kind that is already an area or a count", () => {
    // Walls and ceilings are areas; a door is not taller in square feet. A height field there
    // would be asking for a number nothing could use.
    storeState.roomsByJob[JOB_ID] = [
      room({
        quantities: [
          quantity({ kind: "walls_sqft" }),
          quantity({ kind: "soffit_sqft", value: 24, derivedValue: null, status: "confirmed" }),
          quantity({ kind: "doors_count", value: 2, derivedValue: 2, status: "derived" }),
        ],
      }),
    ];
    render(<RoomCardModalContent />);
    for (const label of [/^Walls \(sq ft\)/, /^Soffit \/ bulkhead \(sq ft\)/, /^Doors/]) {
      fireEvent.click(screen.getByRole("button", { name: label }));
      expect(screen.queryByLabelText("Height (inches)")).toBeNull();
    }
  });

  it("takes a typed height, not a preset", () => {
    storeState.roomsByJob[JOB_ID] = [trimRoom()];
    openBaseboard();
    const field = screen.getByLabelText("Height (inches)");
    fireEvent.change(field, { target: { value: "5.25" } });
    fireEvent.blur(field);
    expect(storeState.setTrimHeight).toHaveBeenCalledWith(JOB_ID, CAPTURE_ID, "baseboard_lnft", 5.25);
  });

  it("commits on Enter as well as blur", () => {
    storeState.roomsByJob[JOB_ID] = [trimRoom()];
    openBaseboard();
    const field = screen.getByLabelText("Height (inches)");
    fireEvent.change(field, { target: { value: "7" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(storeState.setTrimHeight).toHaveBeenCalledWith(JOB_ID, CAPTURE_ID, "baseboard_lnft", 7);
  });

  it("shows the arithmetic the height produces", () => {
    // The reason for asking, shown where it is entered — 38.4 × 5.25 / 12 = 16.8.
    storeState.roomsByJob[JOB_ID] = [trimRoom({ heightIn: 5.25 })];
    openBaseboard();
    expect(screen.getByText(/16\.8 sq ft of face/)).toBeTruthy();
  });

  it("shows the recorded height on the collapsed row", () => {
    // A card that shows only "38.4" has thrown away the distinction the moment the row closes.
    storeState.roomsByJob[JOB_ID] = [trimRoom({ heightIn: 5.25 })];
    render(<RoomCardModalContent />);
    expect(screen.getByText("5.25\u2033")).toBeTruthy();
  });

  it("clears the height when the field is emptied — back to pricing by the foot", () => {
    storeState.roomsByJob[JOB_ID] = [trimRoom({ heightIn: 5.25 })];
    openBaseboard();
    const field = screen.getByLabelText("Height (inches)");
    fireEvent.change(field, { target: { value: "" } });
    fireEvent.blur(field);
    expect(storeState.setTrimHeight).toHaveBeenCalledWith(JOB_ID, CAPTURE_ID, "baseboard_lnft", null);
  });

  it("does not write when the height has not changed", () => {
    // Otherwise simply tapping out of the field fires a mutation.
    storeState.roomsByJob[JOB_ID] = [trimRoom({ heightIn: 5.25 })];
    openBaseboard();
    fireEvent.blur(screen.getByLabelText("Height (inches)"));
    expect(storeState.setTrimHeight).not.toHaveBeenCalled();
  });

  it("points at the None control instead of accepting a zero height", () => {
    // Zero is not a short baseboard — it is the absence of one, and that is a confirmed zero RUN.
    storeState.roomsByJob[JOB_ID] = [trimRoom()];
    openBaseboard();
    const field = screen.getByLabelText("Height (inches)");
    fireEvent.change(field, { target: { value: "0" } });
    fireEvent.blur(field);
    expect(screen.getByText('Use "None in this room" if there is no trim here.')).toBeTruthy();
    expect(storeState.setTrimHeight).not.toHaveBeenCalled();
  });

  it("refuses a height that is really wainscot", () => {
    storeState.roomsByJob[JOB_ID] = [trimRoom()];
    openBaseboard();
    const field = screen.getByLabelText("Height (inches)");
    fireEvent.change(field, { target: { value: "36" } });
    fireEvent.blur(field);
    expect(screen.getByText(/that's wainscot/)).toBeTruthy();
    expect(storeState.setTrimHeight).not.toHaveBeenCalled();
  });

  it("names a value that is not a number", () => {
    storeState.roomsByJob[JOB_ID] = [trimRoom()];
    openBaseboard();
    const field = screen.getByLabelText("Height (inches)");
    fireEvent.change(field, { target: { value: "tall" } });
    fireEvent.blur(field);
    expect(screen.getByText('"tall" is not a number.')).toBeTruthy();
    expect(storeState.setTrimHeight).not.toHaveBeenCalled();
  });

  /**
   * Caught in a browser, not here: with two fields in one expander, moving from the run into the
   * height fired the run's onBlur, which committed AND closed — the row collapsed out from under
   * the painter mid-entry. The unit tests fired blur with no relatedTarget, so every one of them
   * passed through the bug.
   */
  it("stays open when focus moves from the run into the height field", () => {
    storeState.roomsByJob[JOB_ID] = [trimRoom()];
    openBaseboard();
    const run = screen.getByLabelText("Baseboard (ln ft)");
    const height = screen.getByLabelText("Height (inches)");

    fireEvent.blur(run, { relatedTarget: height });

    // Still open — the height field is the proof.
    expect(screen.getByLabelText("Height (inches)")).toBeTruthy();
  });

  it("still closes when focus leaves the row entirely", () => {
    storeState.roomsByJob[JOB_ID] = [trimRoom()];
    openBaseboard();
    const run = screen.getByLabelText("Baseboard (ln ft)");

    fireEvent.change(run, { target: { value: "40" } });
    fireEvent.blur(run, { relatedTarget: null });

    expect(storeState.setRoomQuantity).toHaveBeenCalledWith(JOB_ID, CAPTURE_ID, "baseboard_lnft", 40);
    expect(screen.queryByLabelText("Height (inches)")).toBeNull();
  });

  it("gives a tech no height field — writing numbers into the record is desk work", () => {
    // Same authority as confirm/override, which are already ownerOrOffice.
    mockRoleRef.role = "tech";
    storeState.roomsByJob[JOB_ID] = [trimRoom()];
    render(<RoomCardModalContent />);
    expect(screen.queryByLabelText("Height (inches)")).toBeNull();
  });
});

// ---------------------------------------------------------------------------

// "I scan a room and I just see the total square feet" — the total now shows its working. The
// per-wall areas were already on the phone (the deduction picker lists them); this is the same
// data rendered where the total is questioned: inside the Walls editor, above the field.
describe("RoomCardModalContent — the walls total shows its working", () => {
  const twoWalls = [
    { index: 0, widthFt: 12.3, heightFt: 8, sqft: 98.4 },
    { index: 1, widthFt: 6.5, heightFt: 8, sqft: 52 },
  ];

  it("expanding Walls lists each wall's dims and area, then the measured total", () => {
    // The fixture is COHERENT on purpose: derivedValue is what these walls actually sum to
    // (98.4 + 52.0), because the component's stated invariant is "the total those lines add
    // to" — a green test over walls summing to 150.4 under a printed 560.0 would be the suite
    // blessing the exact contradiction the feature exists to remove.
    storeState.roomsByJob = {
      [JOB_ID]: [
        room({
          walls: twoWalls,
          quantities: [quantity({ value: 150.4, derivedValue: 150.4 })],
        }),
      ],
    };
    render(<RoomCardModalContent />);
    fireEvent.click(screen.getByRole("button", { name: /^Walls \(sq ft\)/ }));

    expect(screen.getByText(/Wall 1 · 12' 4" × 8' 0" · 98\.4 sq ft/)).toBeTruthy();
    expect(screen.getByText(/Wall 2 · 6' 6" × 8' 0" · 52\.0 sq ft/)).toBeTruthy();
    expect(screen.getByText(/Measured total · 150\.4 sq ft/)).toBeTruthy();
  });

  it("shows no breakdown on a manual room — no geometry, no walls to show", () => {
    storeState.roomsByJob = { [JOB_ID]: [room({ source: "manual", walls: [] })] };
    render(<RoomCardModalContent />);
    fireEvent.click(screen.getByRole("button", { name: /^Walls \(sq ft\)/ }));

    expect(screen.queryByText(/Measured total/)).toBeNull();
  });

  it("keeps the breakdown out of every other quantity row", () => {
    storeState.roomsByJob = {
      [JOB_ID]: [
        room({
          walls: twoWalls,
          quantities: [
            quantity(),
            quantity({ kind: "ceiling_sqft", value: 76.7, derivedValue: 76.7 }),
          ],
        }),
      ],
    };
    render(<RoomCardModalContent />);
    fireEvent.click(screen.getByRole("button", { name: /^Ceiling \(sq ft\)/ }));

    expect(screen.queryByText(/Wall 1 ·/)).toBeNull();
  });
});

// "can you make it so that I can actually click and view the scan" — the Scan row, scanned
// rooms only. The viewer itself is tested in room-scan-view.test.tsx; here we pin WHO gets
// the row: a capture has polygons to draw, a hand-entered room has nothing.
describe("RoomCardModalContent — the Scan row", () => {
  it("offers View on a scanned room", () => {
    storeState.roomsByJob = { [JOB_ID]: [room()] };
    render(<RoomCardModalContent />);

    expect(screen.getByRole("button", { name: /^Scan/ })).toBeTruthy();
  });

  it("offers nothing to view on a manual room", () => {
    storeState.roomsByJob = { [JOB_ID]: [room({ source: "manual" })] };
    render(<RoomCardModalContent />);

    expect(screen.queryByRole("button", { name: /^Scan/ })).toBeNull();
  });
});
