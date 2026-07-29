// @vitest-environment jsdom
/**
 * components/modals/job-measure-block.test.tsx
 *
 * Guards JobMeasureBlock (Task 7 + crash/error-state fixes):
 *  - room rows render a headline built from walls_sqft / doors_count
 *  - a Confirm badge shows when any quantity is needs_confirm
 *  - tapping a room pushes the room-card modal in edit mode ({ captureId, jobId })
 *  - "+ Add room" pushes the room-card modal in create mode ({ jobId })
 *  - the empty state shows the "Add" hint, never a dash
 *  - a FAILED list query renders LoadFailed, never the empty state, and its
 *    retry calls the query's refetch (house rule: no silent failures)
 *  - a failed query with rooms already cached in the store still shows the
 *    rooms (shouldShowLoadFailed's count>0 escape hatch)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { JobMeasureBlock, roomHeadline, roomNeedsConfirm } from "./job-measure-block";
import type { RoomCard } from "@/lib/store/types";

const JOB_ID = "job-111";

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
  useJobRoomsMock.mockReturnValue(makeQuery());
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

// ---------------------------------------------------------------------------
// JobMeasureBlock — load-failed state (a failing query must never look like
// an empty job: verified live, a failing list rendered indistinguishably
// from a healthy empty one).
// ---------------------------------------------------------------------------

describe("JobMeasureBlock — load-failed state", () => {
  it("renders LoadFailed, not the empty state, when the query errors with nothing cached", () => {
    mockRooms = [];
    useJobRoomsMock.mockReturnValue(makeQuery({ isFetched: true, isError: true }));
    render(<JobMeasureBlock jobId={JOB_ID} />);

    expect(screen.getByText("Couldn't load your rooms.")).toBeTruthy();
    expect(screen.queryByText("No rooms measured yet.")).toBeNull();
  });

  it("retry calls the query's refetch", () => {
    mockRooms = [];
    const refetch = vi.fn();
    useJobRoomsMock.mockReturnValue(makeQuery({ isFetched: true, isError: true, refetch }));
    render(<JobMeasureBlock jobId={JOB_ID} />);

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it("shows 'Retrying…' and disables the button while a retry is in flight", () => {
    mockRooms = [];
    useJobRoomsMock.mockReturnValue(makeQuery({ isFetched: true, isError: true, isRefetching: true }));
    render(<JobMeasureBlock jobId={JOB_ID} />);

    const btn = screen.getByRole("button", { name: "Retrying…" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("does NOT render LoadFailed while the query is still in flight (not yet fetched)", () => {
    mockRooms = [];
    useJobRoomsMock.mockReturnValue(makeQuery({ isFetched: false, isError: false }));
    render(<JobMeasureBlock jobId={JOB_ID} />);

    expect(screen.queryByText("Couldn't load your rooms.")).toBeNull();
  });

  it("still renders rooms already cached in the store even if the query later errors", () => {
    mockRooms = [makeRoom()];
    useJobRoomsMock.mockReturnValue(makeQuery({ isFetched: true, isError: true }));
    render(<JobMeasureBlock jobId={JOB_ID} />);

    expect(screen.getByText("Living room")).toBeTruthy();
    expect(screen.queryByText("Couldn't load your rooms.")).toBeNull();
  });
});
