// @vitest-environment jsdom
/**
 * app/(field)/my-day/page.test.tsx
 *
 * The agenda used to render straight off the query and only change after a SECOND round trip:
 * ~1.3s for the write, then ~1.2s for the refetch, with the button live and unchanged throughout.
 * People pressed again, and again — production logs show three field.start calls in three seconds
 * and a second field.complete that came back 400. Nothing was broken; the screen just never moved.
 *
 * These lock the three things that fixes it: the card moves on the press, the control is refused
 * for the WHOLE round trip, and anything the write quietly did or failed to do is said out loud.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const setData = vi.fn();
const refetch = vi.fn();
let queryState: {
  data: unknown;
  isLoading: boolean;
  isFetching: boolean;
  isError?: boolean;
  isRefetching?: boolean;
};
let startOpts: { onMutate?: (v: { jobId: string }) => void; onSuccess?: (d: unknown) => void; onError?: (e: unknown) => void } = {};
let completeOpts: typeof startOpts = {};
let startPending = false;
const startMutate = vi.fn();
const completeMutate = vi.fn();

vi.mock("@/lib/trpc/client", () => ({
  api: {
    useUtils: () => ({ v1: { field: { myDay: { setData } } } }),
    v1: {
      field: {
        myDay: { useQuery: () => ({ ...queryState, refetch }) },
        start: {
          useMutation: (opts: typeof startOpts) => {
            startOpts = opts;
            return { mutate: startMutate, isPending: startPending };
          },
        },
        complete: {
          useMutation: (opts: typeof completeOpts) => {
            completeOpts = opts;
            return { mutate: completeMutate, isPending: false };
          },
        },
      },
    },
  },
}));

const notices: string[] = [];
const errors: string[] = [];
vi.mock("@/lib/store/write-error", () => ({
  reportWriteNotice: (_a: string, m: string) => notices.push(m),
  reportWriteError: (a: string) => errors.push(a),
}));

vi.mock("@/lib/store/app-store", () => ({ useOpenModal: () => vi.fn() }));
vi.mock("@/features/field/day-clock", () => ({ DayClock: () => <div /> }));

import MyDayPage from "./page";

const visit = (over: Record<string, unknown> = {}) => ({
  id: "visit-1",
  status: "pending",
  scheduledDate: null,
  scheduledStart: null,
  ...over,
});

const job = (over: Record<string, unknown> = {}) => ({
  id: "job-1",
  num: "JOB-1011",
  title: "random job",
  status: "scheduled",
  scheduledStart: null,
  visits: [],
  ...over,
});

describe("My day — the screen moves when you press", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    notices.length = 0;
    errors.length = 0;
    startPending = false;
    queryState = { data: { items: [job()], customers: [] }, isLoading: false, isFetching: false };
  });

  it("flips the card on the press, not two round trips later", () => {
    render(<MyDayPage />);
    fireEvent.click(screen.getByRole("button", { name: "Start job" }));

    expect(startMutate).toHaveBeenCalledWith({ jobId: "job-1" });
    // The optimistic patch is what the user actually sees change.
    startOpts.onMutate?.({ jobId: "job-1" });
    const patch = setData.mock.calls.at(-1)?.[1] as (p: unknown) => { items: { status: string }[] };
    expect(patch({ items: [job()] }).items[0]!.status).toBe("in_progress");
  });

  it("refuses the button while the refetch is still landing, not just the write", () => {
    // isFetching is the SECOND half of the round trip — leaving the button live during it is
    // exactly the window that turned one press into six.
    queryState = { data: { items: [job()], customers: [] }, isLoading: false, isFetching: true };
    render(<MyDayPage />);
    expect(screen.getByRole("button", { name: "Start job" }).hasAttribute("disabled")).toBe(true);
  });

  it("says so when the clock threw the segment away for being under a minute", () => {
    render(<MyDayPage />);
    completeOpts.onSuccess?.({ clockNotice: "segment_too_short" });
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatch(/under a minute/i);
    expect(notices[0]).toMatch(/My hours/);
  });

  it("stays quiet when the clock did exactly what it looks like it did", () => {
    render(<MyDayPage />);
    completeOpts.onSuccess?.({ clockNotice: null });
    expect(notices).toHaveLength(0);
  });

  it("surfaces a refused write instead of swallowing it", () => {
    render(<MyDayPage />);
    completeOpts.onError?.(new Error("job already complete"));
    expect(errors).toEqual(["field.complete"]);
    expect(refetch).toHaveBeenCalled();
  });
});

describe("My day — a failed load is not a free afternoon", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    startPending = false;
  });

  it("names the failure and offers a retry instead of 'no jobs assigned'", () => {
    queryState = {
      data: undefined,
      isLoading: false,
      isFetching: false,
      isError: true,
      isRefetching: false,
    };
    render(<MyDayPage />);

    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.queryByText(/No jobs assigned to you today/i)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(refetch).toHaveBeenCalled();
  });

  it("keeps the rows it already has when a refetch fails, rather than replacing them", () => {
    // Stale rows beat an error screen: the tech can still drive to the next stop.
    queryState = {
      data: { items: [job()], customers: [] },
      isLoading: false,
      isFetching: false,
      isError: true,
      isRefetching: false,
    };
    render(<MyDayPage />);

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("random job")).toBeTruthy();
  });

  it("still says 'no jobs' on a successful empty day", () => {
    queryState = {
      data: { items: [], customers: [] },
      isLoading: false,
      isFetching: false,
      isError: false,
      isRefetching: false,
    };
    render(<MyDayPage />);

    expect(screen.getByText(/No jobs assigned to you today/i)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

// The time on the card came from `job.scheduledStart` — the DEAD jobs column no live path writes
// — so every row in the agenda printed "—". The real time is on the VISIT, which is where
// scheduling has always put it, and it is a wall-clock string: formatting it must not go anywhere
// near a Date, or a phone in a different zone renders someone else's morning.
describe("My day — the time on the card", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    startPending = false;
  });

  const withVisits = (visits: unknown[]) => {
    queryState = {
      data: { items: [job({ visits })], customers: [] },
      isLoading: false,
      isFetching: false,
      isError: false,
    };
  };

  it("shows the earliest live visit's start time, not the dead job column", () => {
    withVisits([
      visit({ id: "v2", scheduledDate: "2026-08-04", scheduledStart: "15:00" }),
      visit({ id: "v1", scheduledDate: "2026-08-04", scheduledStart: "08:30" }),
    ]);
    render(<MyDayPage />);
    expect(screen.getByText("8:30a")).toBeTruthy();
  });

  it("reads an afternoon time as PM without touching a timezone", () => {
    withVisits([visit({ scheduledDate: "2026-08-04", scheduledStart: "15:00" })]);
    render(<MyDayPage />);
    expect(screen.getByText("3p")).toBeTruthy();
  });

  it("skips a canceled visit", () => {
    withVisits([
      visit({ id: "v1", scheduledDate: "2026-08-04", scheduledStart: "07:00", status: "canceled" }),
      visit({ id: "v2", scheduledDate: "2026-08-04", scheduledStart: "11:15", status: "pending" }),
    ]);
    render(<MyDayPage />);
    expect(screen.getByText("11:15a")).toBeTruthy();
  });

  it("says nothing rather than guessing when the job has no dated visit", () => {
    withVisits([visit({ scheduledStart: "09:00" })]);
    render(<MyDayPage />);
    expect(screen.getByText("—")).toBeTruthy();
  });
});
