// @vitest-environment jsdom
/**
 * features/field/day-clock.test.tsx
 *
 * The day row's contract: it shows the state of a PERSISTED time entry, it moves the moment a
 * button is pressed, and a refused tap puts it back where it was and says so. The version this
 * replaced kept its state in React, so none of these could be asserted at all.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

type TapArgs = { tap: string; at: string };
type TapCallbacks = {
  onSuccess: (result: { open: unknown }) => void;
  onError: (error: unknown) => void;
};

let openQuery: {
  data?: { open: unknown };
  isError: boolean;
  isFetched: boolean;
  isFetching: boolean;
  refetch: () => void;
};
let lastTap: { args: TapArgs; callbacks: TapCallbacks } | null = null;

const mutate = vi.fn((args: TapArgs, callbacks: TapCallbacks) => {
  lastTap = { args, callbacks };
});
const setOpenData = vi.fn();
const invalidateList = vi.fn();
const reportWriteError = vi.fn();

vi.mock("@/lib/trpc/client", () => ({
  api: {
    v1: {
      timesheets: {
        open: { useQuery: () => openQuery },
        clockTap: { useMutation: () => ({ mutate }) },
      },
    },
    useUtils: () => ({
      v1: {
        timesheets: {
          open: { setData: setOpenData },
          list: { invalidate: invalidateList },
        },
      },
    }),
  },
}));

vi.mock("@/lib/store/write-error", () => ({
  reportWriteError: (action: string, error: unknown) => reportWriteError(action, error),
}));

import { DayClock } from "./day-clock";

// @/lib/clock is mocked globally to 2026-07-01, so a today-dated entry shows no date suffix.
const TODAY = "2026-07-01";

function serverEntry(over: Record<string, unknown> = {}) {
  return {
    id: "te-1",
    techUserId: "user-1",
    jobId: null,
    workDate: TODAY,
    kind: "shop",
    startTime: "07:42",
    endTime: null,
    note: "",
    src: "clock",
    status: "draft",
    running: true,
    approvedAt: null,
    createdAt: "2026-07-01T14:42:00.000Z",
    ...over,
  };
}

function loaded(open: unknown) {
  return { data: { open }, isError: false, isFetched: true, isFetching: false, refetch: vi.fn() };
}

beforeEach(() => {
  vi.useFakeTimers();
  // Local wall time 9:05am — the optimistic label is built from the device clock.
  vi.setSystemTime(new Date(2026, 6, 1, 9, 5));
  openQuery = loaded(null);
  lastTap = null;
  mutate.mockClear();
  setOpenData.mockClear();
  invalidateList.mockClear();
  reportWriteError.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// The three states
// ---------------------------------------------------------------------------

describe("DayClock — the three states", () => {
  it("off the clock: one way in, and no way to end a day that never started", () => {
    render(<DayClock />);
    expect(screen.getByText("Off the clock")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start day" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "End day" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Break" })).toBeNull();
  });

  it("on the clock: names the start time and offers Break and End day", () => {
    openQuery = loaded(serverEntry());
    render(<DayClock />);
    expect(screen.getByText("On the clock")).toBeTruthy();
    expect(screen.getByText("since 7:42a")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Break" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "End day" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Start day" })).toBeNull();
  });

  it("shows the running total, and advances it as the clock runs", () => {
    openQuery = loaded(serverEntry());
    render(<DayClock />);
    // 7:42a → 9:05a.
    expect(screen.getByText("1:23")).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByText("1:24")).toBeTruthy();
  });

  it("keeps the running total out of the visual baseline", () => {
    openQuery = loaded(serverEntry());
    const { container } = render(<DayClock />);
    expect(container.querySelector(".clock-elapsed")?.hasAttribute("data-dynamic")).toBe(true);
  });

  it("shows no total when nobody is on the clock", () => {
    openQuery = loaded(null);
    const { container } = render(<DayClock />);
    expect(container.querySelector(".clock-elapsed")).toBeNull();
  });

  it("on break: names the break start and offers only the way out", () => {
    openQuery = loaded(serverEntry({ kind: "break", startTime: "12:05" }));
    render(<DayClock />);
    expect(screen.getByText("On break")).toBeTruthy();
    expect(screen.getByText("since 12:05p")).toBeTruthy();
    expect(screen.getByRole("button", { name: "End break" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Break" })).toBeNull();
    expect(screen.queryByRole("button", { name: "End day" })).toBeNull();
  });

  it("reads an on-site job segment as simply on the clock — the row is about being paid", () => {
    openQuery = loaded(serverEntry({ kind: "job", jobId: "job-1", startTime: "09:00" }));
    render(<DayClock />);
    expect(screen.getByText("On the clock")).toBeTruthy();
    expect(screen.getByText("since 9a")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// The transitions
// ---------------------------------------------------------------------------

describe("DayClock — transitions", () => {
  it("Start day moves the row before the server answers, and sends the device's timestamp", () => {
    render(<DayClock />);
    fireEvent.click(screen.getByRole("button", { name: "Start day" }));

    // Optimistic: the row already reads as running, with no server round-trip.
    expect(screen.getByText("On the clock")).toBeTruthy();
    expect(screen.getByText("since 9:05a")).toBeTruthy();
    expect(lastTap?.args.tap).toBe("start_day");
    expect(lastTap?.args.at).toBe(new Date(2026, 6, 1, 9, 5).toISOString());
  });

  it("adopts the server's entry when the tap lands", () => {
    render(<DayClock />);
    fireEvent.click(screen.getByRole("button", { name: "Start day" }));

    const result = { open: serverEntry({ startTime: "09:06" }) };
    act(() => lastTap?.callbacks.onSuccess(result));

    expect(setOpenData).toHaveBeenCalledWith(undefined, result);
    // My hours reads its own query and would otherwise miss the new segment.
    expect(invalidateList).toHaveBeenCalled();
  });

  it("on the clock → Break shows the break immediately", () => {
    openQuery = loaded(serverEntry());
    render(<DayClock />);
    fireEvent.click(screen.getByRole("button", { name: "Break" }));

    expect(screen.getByText("On break")).toBeTruthy();
    expect(screen.getByRole("button", { name: "End break" })).toBeTruthy();
    expect(lastTap?.args.tap).toBe("break");
  });

  it("on break → End break puts him back on the clock", () => {
    openQuery = loaded(serverEntry({ kind: "break", startTime: "12:05" }));
    render(<DayClock />);
    fireEvent.click(screen.getByRole("button", { name: "End break" }));

    expect(screen.getByText("On the clock")).toBeTruthy();
    expect(lastTap?.args.tap).toBe("end_break");
  });

  it("on the clock → End day takes him off it", () => {
    openQuery = loaded(serverEntry());
    render(<DayClock />);
    fireEvent.click(screen.getByRole("button", { name: "End day" }));

    expect(screen.getByText("Off the clock")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start day" })).toBeTruthy();
    expect(lastTap?.args.tap).toBe("end_day");
  });

  it("a refused tap rolls the row back and names the button that failed", () => {
    render(<DayClock />);
    fireEvent.click(screen.getByRole("button", { name: "Start day" }));
    expect(screen.getByText("On the clock")).toBeTruthy();

    act(() => lastTap?.callbacks.onError(new Error("offline")));

    expect(screen.getByText("Off the clock")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start day" })).toBeTruthy();
    expect(reportWriteError).toHaveBeenCalledWith("startDay", expect.any(Error));
    expect(setOpenData).not.toHaveBeenCalled();
  });

  it("a failed End day leaves him ON the clock — the hours are not silently dropped", () => {
    openQuery = loaded(serverEntry());
    render(<DayClock />);
    fireEvent.click(screen.getByRole("button", { name: "End day" }));

    act(() => lastTap?.callbacks.onError(new Error("offline")));

    expect(screen.getByText("On the clock")).toBeTruthy();
    expect(screen.getByText("since 7:42a")).toBeTruthy();
    expect(reportWriteError).toHaveBeenCalledWith("endDay", expect.any(Error));
  });
});

// ---------------------------------------------------------------------------
// Load states — a row that cannot be read must not claim a state
// ---------------------------------------------------------------------------

describe("DayClock — load states", () => {
  it("a failed load says so and offers a retry, instead of inviting a second punch", () => {
    const refetch = vi.fn();
    openQuery = { data: undefined, isError: true, isFetched: true, isFetching: false, refetch };
    render(<DayClock />);

    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Start day" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(refetch).toHaveBeenCalled();
  });

  it("claims no state while the first read is still in flight", () => {
    openQuery = { data: undefined, isError: false, isFetched: false, isFetching: true, refetch: vi.fn() };
    render(<DayClock />);

    expect(screen.queryByText("Off the clock")).toBeNull();
    expect(screen.queryByRole("button", { name: "Start day" })).toBeNull();
    expect(screen.getByRole("status")).toBeTruthy();
  });
});
