// @vitest-environment jsdom
/**
 * components/modals/job-measure-block.test.tsx
 *
 * Guards JobMeasureBlock (Task 7):
 *  - room rows render a headline built from walls_sqft / doors_count
 *  - a Confirm badge shows when any quantity is needs_confirm
 *  - tapping a room pushes the room-card modal in edit mode ({ captureId, jobId })
 *  - "+ Add room" pushes the room-card modal in create mode ({ jobId })
 *  - the empty state shows the "Add" hint, never a dash
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { JobMeasureBlock, roomHeadline, roomNeedsConfirm } from "./job-measure-block";
import type { RoomCard } from "@/lib/store/types";

const JOB_ID = "job-111";

let mockRooms: RoomCard[] = [];
const pushModalMock = vi.fn();
const useJobRoomsMock = vi.fn();

vi.mock("@/lib/store/app-store", () => ({
  usePushModal: () => pushModalMock,
  useAppStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ roomsByJob: { [JOB_ID]: mockRooms } }),
}));

vi.mock("@/features/measurements/use-job-rooms", () => ({
  useJobRooms: (...args: unknown[]) => useJobRoomsMock(...args),
}));

function makeRoom(overrides: Partial<RoomCard> = {}): RoomCard {
  return {
    id: "room-1",
    jobId: JOB_ID,
    roomName: "Living room",
    source: "roomplan_v1",
    capturedAt: "2026-07-01T00:00:00.000Z",
    quantities: [
      { kind: "walls_sqft", value: 562, derivedValue: 560, status: "confirmed" },
      { kind: "doors_count", value: 2, derivedValue: 2, status: "confirmed" },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  mockRooms = [];
  pushModalMock.mockReset();
  useJobRoomsMock.mockReset();
});

// ---------------------------------------------------------------------------
// roomHeadline / roomNeedsConfirm — pure helpers
// ---------------------------------------------------------------------------

describe("roomHeadline", () => {
  it("builds a headline from walls_sqft and doors_count when present", () => {
    expect(roomHeadline(makeRoom().quantities)).toBe("562 sqft walls · 2 doors");
  });

  it("falls back to a generic label when neither kind is present", () => {
    expect(
      roomHeadline([{ kind: "ceiling_sqft", value: 500, derivedValue: 500, status: "confirmed" }]),
    ).toBe("Not measured yet");
  });

  it("singularizes 1 door", () => {
    const quantities = [
      { kind: "doors_count" as const, value: 1, derivedValue: 1, status: "confirmed" as const },
    ];
    expect(roomHeadline(quantities)).toBe("1 door");
  });
});

describe("roomNeedsConfirm", () => {
  it("is true when any quantity is needs_confirm", () => {
    const room = makeRoom({
      quantities: [
        { kind: "walls_sqft", value: 562, derivedValue: 560, status: "needs_confirm" },
      ],
    });
    expect(roomNeedsConfirm(room)).toBe(true);
  });

  it("is false when all quantities are settled", () => {
    expect(roomNeedsConfirm(makeRoom())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// JobMeasureBlock — render tests
// ---------------------------------------------------------------------------

describe("JobMeasureBlock", () => {
  it("renders a room row with its headline", () => {
    mockRooms = [makeRoom()];
    render(<JobMeasureBlock jobId={JOB_ID} />);

    expect(screen.getByText("Living room")).toBeTruthy();
    expect(screen.getByText("562 sqft walls · 2 doors")).toBeTruthy();
    expect(useJobRoomsMock).toHaveBeenCalledWith(JOB_ID);
  });

  it("shows a Confirm badge when a quantity needs_confirm", () => {
    mockRooms = [
      makeRoom({
        quantities: [
          { kind: "walls_sqft", value: 562, derivedValue: 560, status: "needs_confirm" },
        ],
      }),
    ];
    render(<JobMeasureBlock jobId={JOB_ID} />);

    expect(screen.getByText("Confirm")).toBeTruthy();
  });

  it("does not show a Confirm badge when nothing needs confirmation", () => {
    mockRooms = [makeRoom()];
    render(<JobMeasureBlock jobId={JOB_ID} />);

    expect(screen.queryByText("Confirm")).toBeNull();
  });

  it("pushes the room-card modal in edit mode when a room row is tapped", () => {
    mockRooms = [makeRoom({ id: "room-42" })];
    render(<JobMeasureBlock jobId={JOB_ID} />);

    fireEvent.click(screen.getByText("Living room"));

    expect(pushModalMock).toHaveBeenCalledWith("room-card", { captureId: "room-42", jobId: JOB_ID });
  });

  it("pushes the room-card modal in create mode from '+ Add room'", () => {
    mockRooms = [makeRoom()];
    render(<JobMeasureBlock jobId={JOB_ID} />);

    fireEvent.click(screen.getByText("+ Add room"));

    expect(pushModalMock).toHaveBeenCalledWith("room-card", { jobId: JOB_ID });
  });

  it("shows the 'Add' hint empty state, never a dash, when there are no rooms", () => {
    mockRooms = [];
    render(<JobMeasureBlock jobId={JOB_ID} />);

    expect(screen.getByText("No rooms measured yet.")).toBeTruthy();
    expect(screen.getByText("+ Add room")).toBeTruthy();
    expect(screen.queryByText("—")).toBeNull();
  });
});
