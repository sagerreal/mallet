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
const useRoomScanAvailableMock = vi.fn();

vi.mock("@/lib/store/app-store", () => ({
  useActiveModal: () => ({ id: "room-card", params: activeModalParams }),
  useCloseModal: () => closeMock,
  usePushModal: () => pushModalMock,
  useAppStore: (selector: (s: Store) => unknown) => selector(storeState),
}));

vi.mock("@/features/measurements/use-job-rooms", () => ({
  useJobRooms: (...args: unknown[]) => useJobRoomsMock(...args),
}));

vi.mock("@/lib/native/room-scan", async () => {
  const actual = await vi.importActual<typeof import("@/lib/native/room-scan")>("@/lib/native/room-scan");
  return {
    ...actual,
    useRoomScanAvailable: () => useRoomScanAvailableMock(),
  };
});

import { RoomCardModalContent, quantityDisplay, parseQuantityInput, formatQuantity } from "./room-card-modal";
import { RoomScanPayloadError } from "@/lib/native/room-scan";

function job(overrides: Partial<Job> = {}): Job {
  return { id: JOB_ID, title: "Repaint job", leadId: "l1", svc: null, origin: "manual", addr: "", phone: "", status: "unscheduled", archived: false, lines: [], addons: [], photos: [], notes: "", acts: [], visits: [], ...overrides } as Job;
}

function quantity(overrides: Partial<RoomQuantity> = {}): RoomQuantity {
  return { kind: "walls_sqft", value: 562, derivedValue: 560, status: "derived", ...overrides };
}

function room(overrides: Partial<RoomCard> = {}): RoomCard {
  return {
    id: CAPTURE_ID,
    jobId: JOB_ID,
    roomName: "Living room",
    source: "roomplan_v1",
    capturedAt: "2026-07-29T00:00:00.000Z",
    quantities: [quantity()],
    ...overrides,
  };
}

beforeEach(() => {
  activeModalParams = { captureId: CAPTURE_ID, jobId: JOB_ID };
  closeMock.mockReset();
  pushModalMock.mockReset();
  useJobRoomsMock.mockReset();
  useRoomScanAvailableMock.mockReset();
  useRoomScanAvailableMock.mockReturnValue(false);
  storeState = {
    roomsByJob: { [JOB_ID]: [room()] },
    jobs: [job()],
    setRoomQuantity: vi.fn(),
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

  it("shows the rescan note only for roomplan_v1 rooms", () => {
    render(<RoomCardModalContent />);
    expect(screen.getByText(/Re-scan replaces these numbers/)).toBeTruthy();
  });

  it("does not show the rescan note for a manual room", () => {
    storeState.roomsByJob[JOB_ID] = [room({ source: "manual" })];
    render(<RoomCardModalContent />);
    expect(screen.queryByText(/Re-scan replaces these numbers/)).toBeNull();
  });

  it("commits a typed value on blur via setRoomQuantity", () => {
    render(<RoomCardModalContent />);
    fireEvent.click(screen.getByText("Walls (sq ft)"));
    const input = screen.getByLabelText("Walls (sq ft)");
    fireEvent.change(input, { target: { value: "600" } });
    fireEvent.blur(input);
    expect(storeState.setRoomQuantity).toHaveBeenCalledWith(JOB_ID, CAPTURE_ID, "walls_sqft", 600);
  });

  it("commits a typed value on Enter", () => {
    render(<RoomCardModalContent />);
    fireEvent.click(screen.getByText("Walls (sq ft)"));
    const input = screen.getByLabelText("Walls (sq ft)");
    fireEvent.change(input, { target: { value: "600" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(storeState.setRoomQuantity).toHaveBeenCalledWith(JOB_ID, CAPTURE_ID, "walls_sqft", 600);
  });

  it("invalid input shows the named error and keeps the row open without calling the store", () => {
    render(<RoomCardModalContent />);
    fireEvent.click(screen.getByText("Walls (sq ft)"));
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
    fireEvent.click(screen.getByText("Walls (sq ft)"));
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
// View mode — live re-scan row (roomplan_v1 + roomScanAvailable() only)
// ---------------------------------------------------------------------------

describe("RoomCardModalContent — view mode rescan row", () => {
  it("stays text-only when scanning is unavailable — web-unchanged, no diff", () => {
    useRoomScanAvailableMock.mockReturnValue(false);
    const { container } = render(<RoomCardModalContent />);

    expect(screen.getByText("Re-scan replaces these numbers and clears edits.")).toBeTruthy();
    expect(screen.queryByText("Re-scan room")).toBeNull();
    expect(container.querySelector("button.linklike")).toBeNull();
  });

  it("does not show any rescan row for a manual room even when scanning is available", () => {
    useRoomScanAvailableMock.mockReturnValue(true);
    storeState.roomsByJob[JOB_ID] = [room({ source: "manual" })];
    render(<RoomCardModalContent />);

    expect(screen.queryByText("Re-scan room")).toBeNull();
    expect(screen.queryByText("Re-scan replaces these numbers and clears edits.")).toBeNull();
  });

  it("becomes a two-tap armed control when scanning is available", () => {
    useRoomScanAvailableMock.mockReturnValue(true);
    render(<RoomCardModalContent />);

    expect(screen.getByText("Re-scan room")).toBeTruthy();
    expect(screen.queryByText("Re-scan replaces these numbers and clears edits.")).toBeNull();
  });

  it("arms on first tap, fires rescanRoom on second tap, and re-opens on the new capture id", async () => {
    useRoomScanAvailableMock.mockReturnValue(true);
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
    useRoomScanAvailableMock.mockReturnValue(true);
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
    useRoomScanAvailableMock.mockReturnValue(true);
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

  it("shows a generic save-error copy on any other rescan failure", async () => {
    useRoomScanAvailableMock.mockReturnValue(true);
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

  it("shows a generic save-error copy on any other scan failure, form stays open", async () => {
    storeState.scanRoom.mockRejectedValue(new Error("network down"));
    render(<RoomCardModalContent />);

    fireEvent.change(screen.getByLabelText("Room name"), { target: { value: "Kitchen" } });
    fireEvent.click(screen.getByRole("button", { name: "Start scanning" }));

    await waitFor(() => expect(screen.getByText(/Couldn't save this scan/)).toBeTruthy());
    expect(closeMock).not.toHaveBeenCalled();
  });
});
