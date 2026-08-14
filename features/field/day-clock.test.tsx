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
// The DAY, from v1.timesheets.list — the same query My hours reads, and the reason the card can
// still show the day's total after End day has closed the running row. Its FAILURE state is part
// of the mock because it is part of the contract: a refused read must not render as an empty day.
let listQuery: {
  data?: { items: unknown[] };
  isError: boolean;
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
        list: { useQuery: () => listQuery },
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

// The day panel's list read is scoped to the caller — an unscoped fetch would total somebody
// else's day into an owner-operator's.
vi.mock("@/features/identity/hooks", () => ({
  useMe: () => ({ data: { userId: "user-1", role: "tech" } }),
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

/** A settled `v1.timesheets.list` read — the day's rows, and no refusal. */
function dayRows(items: unknown[]) {
  return { data: { items }, isError: false, isFetching: false, refetch: vi.fn() };
}

/** One timesheet row as v1.timesheets.list returns it. */
function row(over: Record<string, unknown> = {}) {
  return { ...serverEntry(), endTime: "08:30", running: false, ...over };
}

/**
 * A normal morning: regular time, a fifteen-minute break, then a stretch still running at 9:05.
 *
 * The running stretch is regular time with a job row beside it — the panel names the job from the
 * agenda but counts the shift. Worked = 0:48 + 0:20 = 1:08, Break = 0:15. Deliberately NOT in start order — the
 * server sorts a day by (work_date, id), i.e. UUID order, and the panel has to fix that itself.
 */
function morning() {
  return [
    // Two lanes at once: the shift that pays, and the job row beside it that names what he is on.
    row({ id: "c", kind: "shop", startTime: "08:45", endTime: null, running: true }),
    row({ id: "d", jobId: "job-1", kind: "job", startTime: "08:45", endTime: null, running: true }),
    row({ id: "a", kind: "shop", startTime: "07:42", endTime: "08:30" }),
    row({ id: "b", kind: "break", startTime: "08:30", endTime: "08:45" }),
  ];
}

beforeEach(() => {
  vi.useFakeTimers();
  // Local wall time 9:05am — the optimistic label is built from the device clock.
  vi.setSystemTime(new Date(2026, 6, 1, 9, 5));
  openQuery = loaded(null);
  // No rows by default: the head then carries no total and offers no expander, which is the
  // honest state before the first punch of the day.
  listQuery = dayRows([]);
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

  // THE FIGURE IS THE DAY, NOT THE STRETCH. It used to be the length of the current segment,
  // which resets on every break and every job start — at 4pm after a normal day it read 0:50.
  it("shows the DAY's worked total, and advances it as the clock runs", () => {
    openQuery = loaded(serverEntry({ kind: "shop", jobId: "job-1", startTime: "08:45" }));
    listQuery = dayRows(morning());
    render(<DayClock />);
    // shop 0:48 + the running job 0:20. The unpaid break is not in it.
    expect(screen.getByText("1h 8m")).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByText("1h 9m")).toBeTruthy();
  });

  it("keeps the day total out of the visual baseline", () => {
    listQuery = dayRows(morning());
    const { container } = render(<DayClock />);
    expect(container.querySelector(".clock-elapsed")?.hasAttribute("data-dynamic")).toBe(true);
  });

  it("shows an honest zero, and no expander, before the first punch of the day", () => {
    // The DAY TOTAL face always draws its figure — an empty day IS 0h 0m (the read answered).
    // The expander stays gated: an expander onto an empty panel is a dead control.
    openQuery = loaded(null);
    const { container } = render(<DayClock />);
    expect(screen.getByText("0h 0m")).toBeTruthy();
    expect(screen.queryByRole("button", { expanded: false })).toBeNull();
    expect(container.querySelector(".clock-open")).toBeNull();
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
    openQuery = loaded(serverEntry({ kind: "shop", jobId: "job-1", startTime: "09:00" }));
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

// ---------------------------------------------------------------------------
// The day panel — the card, tapped open. It reads v1.timesheets.list, NOT
// v1.timesheets.open, so it survives End day.
// ---------------------------------------------------------------------------

const JOBS = [{ id: "job-1", num: "JOB-2541", title: "Water heater repair", customerName: "Delgado" }];

describe("DayClock — today's hours, expanded in place", () => {
  beforeEach(() => {
    openQuery = loaded(serverEntry({ kind: "shop", jobId: "job-1", startTime: "08:45" }));
    listQuery = dayRows(morning());
  });

  const openPanel = () => fireEvent.click(screen.getByRole("button", { expanded: false }));

  it("stays shut until it is asked for, and then pushes the agenda down in flow", () => {
    const { container } = render(<DayClock jobs={JOBS} />);
    expect(container.querySelector(".clock-day")).toBeNull();
    openPanel();
    expect(container.querySelector(".clock-day")).not.toBeNull();
    expect(screen.getByRole("button", { expanded: true })).toBeTruthy();
  });

  it("names when the day began", () => {
    render(<DayClock jobs={JOBS} />);
    openPanel();
    expect(screen.getByText("Day started 7:42a")).toBeTruthy();
  });

  // THE SERVER ORDERS A DAY BY (work_date, id) — UUID order. Unsorted, this reads as nonsense.
  it("lists the day in the order it happened, not the order the rows came back", () => {
    const { container } = render(<DayClock jobs={JOBS} />);
    openPanel();
    const spans = [...container.querySelectorAll(".clock-seg-t")].map((n) => n.textContent);
    expect(spans).toEqual(["7:42a – 8:30a", "8:30a – 8:45a", "8:45a –"]);
  });

  it("names a job segment from the agenda instead of calling it 'Job'", () => {
    render(<DayClock jobs={JOBS} />);
    openPanel();
    expect(screen.getByText("#JOB-2541 Delgado — now")).toBeTruthy();
  });

  it("names a job that is no longer on the agenda plainly, never with the wrong name", () => {
    render(<DayClock jobs={[]} />);
    openPanel();
    expect(screen.getByText("Job — now")).toBeTruthy();
  });

  // Breaks are separate rows with their own start and end, and break is the only unpaid kind. A
  // single "0:15 of break" would hide a lunch left running, which is how this record goes wrong.
  it("lists breaks individually and totals them apart from the paid time", () => {
    const { container } = render(<DayClock jobs={JOBS} />);
    openPanel();
    const labels = [...container.querySelectorAll(".clock-seg-l")].map((n) => n.textContent);
    expect(labels).toContain("Break");
    // Twice, and both are right: the break's own row and the day's unpaid total.
    expect(screen.getByText("Break (unpaid)")).toBeTruthy();
    expect(screen.getAllByText("0:15")).toHaveLength(2);
  });

  // entryHours returns 0 for a row with no endTime — right for a timesheet, wrong for a man
  // looking at his own day at 9am. A naive sum omits the minutes he is standing in.
  it("counts the RUNNING stretch, which sums to nothing on its own", () => {
    render(<DayClock jobs={JOBS} />);
    openPanel();
    expect(screen.getByText("0:20")).toBeTruthy();
    expect(screen.getAllByText("1:08").length).toBeGreaterThan(0);
  });

  it("marks only the live figures dynamic, so the settled ones still guard the baseline", () => {
    const { container } = render(<DayClock jobs={JOBS} />);
    openPanel();
    const settled = [...container.querySelectorAll(".clock-seg")].filter(
      (n) => n.querySelector(".clock-seg-t")?.textContent === "7:42a – 8:30a",
    )[0];
    expect(settled?.querySelector(".clock-seg-d")?.hasAttribute("data-dynamic")).toBe(false);
  });

  // THE WHOLE REASON IT READS `list`. After End day, `open` is null and the card would otherwise
  // revert to "Off the clock / Start day" and know nothing about the day it just finished.
  it("still shows the finished day after End day, when nothing is running", () => {
    openQuery = loaded(null);
    listQuery = dayRows([
      row({ id: "a", kind: "shop", startTime: "07:42", endTime: "08:30" }),
      row({ id: "b", kind: "break", startTime: "08:30", endTime: "08:45" }),
    ]);
    render(<DayClock jobs={JOBS} />);
    expect(screen.getByText("Off the clock")).toBeTruthy();
    openPanel();
    expect(screen.getByText("Worked today")).toBeTruthy();
    expect(screen.getAllByText("0:48").length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// The hours read FAILED. The reason this panel exists is that `open` alone forgets the day the
// moment End day closes it — so a refused `list` read puts the card back in exactly the state the
// feature was built to prevent, and does it silently.
// ---------------------------------------------------------------------------

/** A refused `v1.timesheets.list` read. */
function dayFailed(refetch: () => void) {
  return { data: undefined, isError: true, isFetching: false, refetch };
}

describe("DayClock — a refused hours read", () => {
  it("says the hours could not be read, instead of rendering a day with no punches", () => {
    openQuery = loaded(serverEntry());
    listQuery = dayFailed(vi.fn());
    render(<DayClock />);

    expect(screen.getByRole("alert").textContent).toContain("Couldn't load your hours.");
  });

  // The state sentence comes from `open`, which answered. Only the day is unknown.
  it("keeps the state sentence and the day's actions", () => {
    openQuery = loaded(serverEntry());
    listQuery = dayFailed(vi.fn());
    render(<DayClock />);

    expect(screen.getByText("On the clock")).toBeTruthy();
    expect(screen.getByRole("button", { name: "End day" })).toBeTruthy();
  });

  it("offers a retry that refetches the day", () => {
    const refetch = vi.fn();
    openQuery = loaded(serverEntry());
    listQuery = dayFailed(refetch);
    render(<DayClock />);

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(refetch).toHaveBeenCalled();
  });

  it("names the retry as in flight while it runs", () => {
    openQuery = loaded(serverEntry());
    listQuery = { data: undefined, isError: true, isFetching: true, refetch: vi.fn() };
    render(<DayClock />);

    expect(screen.getByRole("button", { name: "Retrying…" })).toBeTruthy();
  });

  // The tell that this is NOT the empty-day render: an empty day shows 0h 0m; a refused read
  // shows a dash — "we could not ask" must never read as "you have not worked".
  it("draws a dash for the total, and no expander, because neither is known", () => {
    openQuery = loaded(serverEntry());
    listQuery = dayFailed(vi.fn());
    const { container } = render(<DayClock />);

    expect(screen.getByText("—")).toBeTruthy();
    expect(screen.queryByText("0h 0m")).toBeNull();
    expect(container.querySelector(".clock-open")).toBeNull();
    expect(container.querySelector(".clock-day")).toBeNull();
  });
});
