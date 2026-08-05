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

// One stable spy, not a fresh vi.fn() per render — the row-tap tests below assert on it.
const openModal = vi.fn();
vi.mock("@/lib/store/app-store", () => ({ useOpenModal: () => openModal }));
vi.mock("@/features/field/day-clock", () => ({ DayClock: () => <div /> }));

import MyDayPage from "./page";
import { MODAL } from "@/lib/store/modal-ids";

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

  // THE ASYMMETRY. The job sheet's Done has always worked straight from scheduled; this card
  // offered only "Start job" and the endpoint behind ✓ Complete refused a scheduled job outright.
  // A technician who finished a call without tapping Start hit a wall on the card and none on the
  // sheet, which reads as the app contradicting itself. v1.field.complete now starts it first.
  it("lets a SCHEDULED job be completed without pressing Start first", () => {
    render(<MyDayPage />);
    expect(screen.getByRole("button", { name: "Start job" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "✓ Complete" }));
    expect(completeMutate).toHaveBeenCalledWith({ jobId: "job-1" });
  });

  it("still moves the card straight to done on that press", () => {
    render(<MyDayPage />);
    fireEvent.click(screen.getByRole("button", { name: "✓ Complete" }));
    completeOpts.onMutate?.({ jobId: "job-1" });
    const patch = setData.mock.calls.at(-1)?.[1] as (p: unknown) => { items: { status: string }[] };
    expect(patch({ items: [job()] }).items[0]!.status).toBe("complete");
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

// Owen, testing: "when I click on the job on this page sometimes it doesn't enter the modal ...
// perhaps I am not clicking the right spot."
//
// He wasn't. The row carried the open handler, but the .md-acts wrapper around Start job /
// ✓ Complete called stopPropagation on EVERY click inside it. That wrapper is a full-width flex
// row — on a phone a ~46px band across the whole bottom of the card — so the entire strip beside
// the button was dead. Worse, .md-stop:active still tinted and compressed the row under the
// finger, so the card visibly acknowledged the press and then did nothing.
//
// "Sometimes" is the tell: the strip only exists while a job is scheduled or in progress. A job
// finished today (which PR #380 now keeps on the list) has no action button, so those rows always
// worked — which is exactly what makes it feel random rather than broken.
describe("My day — the whole row opens the job, not just the words", () => {
  const rowAt = (over: Record<string, unknown> = {}) => ({
    data: {
      items: [job({ visits: [visit({ scheduledDate: "2026-08-04", scheduledStart: "08:30" })], ...over })],
      customers: [],
    },
    isLoading: false,
    isFetching: false,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    startPending = false;
    queryState = rowAt();
  });

  it("opens from the time, which is not a word anyone typed", () => {
    render(<MyDayPage />);
    fireEvent.click(screen.getByText("8:30a"));
    expect(openModal).toHaveBeenCalledWith(MODAL.TECH_JOB, { jobId: "job-1" });
  });

  it("opens from the job-number line under the title", () => {
    render(<MyDayPage />);
    fireEvent.click(screen.getByText(/JOB-1011/));
    expect(openModal).toHaveBeenCalledWith(MODAL.TECH_JOB, { jobId: "job-1" });
  });

  // THE REGRESSION. This is the band that swallowed the tap.
  it("opens from the empty strip beside the action button", () => {
    const { container } = render(<MyDayPage />);
    const acts = container.querySelector(".md-acts");
    expect(acts).not.toBeNull();
    // Clicking the WRAPPER, not the button inside it — the pixels a thumb lands on.
    fireEvent.click(acts!);
    expect(openModal).toHaveBeenCalledWith(MODAL.TECH_JOB, { jobId: "job-1" });
  });

  // The keyboard path: a real, named button, so the row is reachable by tab and opens on Enter.
  it("keeps the title a focusable button that opens the job exactly once", () => {
    render(<MyDayPage />);
    fireEvent.click(screen.getByRole("button", { name: "Open random job" }));
    expect(openModal).toHaveBeenCalledTimes(1);
    expect(openModal).toHaveBeenCalledWith(MODAL.TECH_JOB, { jobId: "job-1" });
  });

  it("starts the job without also opening it when Start job is pressed", () => {
    render(<MyDayPage />);
    fireEvent.click(screen.getByRole("button", { name: "Start job" }));
    expect(startMutate).toHaveBeenCalledWith({ jobId: "job-1" });
    expect(openModal).not.toHaveBeenCalled();
  });

  it("completes the job without also opening it when ✓ Complete is pressed", () => {
    queryState = rowAt({ status: "in_progress" });
    render(<MyDayPage />);
    fireEvent.click(screen.getByRole("button", { name: /Complete/ }));
    expect(completeMutate).toHaveBeenCalledWith({ jobId: "job-1" });
    expect(openModal).not.toHaveBeenCalled();
  });
});
