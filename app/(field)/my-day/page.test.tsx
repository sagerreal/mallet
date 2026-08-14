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
// Start job / ✓ Complete move the CLOCK server-side, so they must invalidate its two queries —
// without this the card sat on the previous segment until something remounted it.
const invalidateOpen = vi.fn();
const invalidateList = vi.fn();
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
let enrouteOpts: { onMutate?: (v: { jobId: string; visitId: string }) => void; onSuccess?: (d: unknown) => void; onError?: (e: unknown) => void; retry?: number } = {};
let visitStatusOpts: { onMutate?: (v: { jobId: string; visitId: string; status: string }) => void; onSuccess?: (d: unknown) => void; onError?: (e: unknown) => void } = {};
const enrouteMutate = vi.fn();
const visitStatusMutate = vi.fn();
const adoptJobSpy = vi.fn();
const pushModal = vi.fn();
let dayQueryState: { data: unknown; isLoading: boolean; isFetched?: boolean; isError?: boolean; isRefetching?: boolean } = {
  data: undefined,
  isLoading: false,
};
const dayRefetch = vi.fn();
let standardDayData: { minutes: number | null } | undefined = { minutes: 480 };

vi.mock("@/lib/trpc/client", () => ({
  api: {
    useUtils: () => ({
      v1: {
        field: { myDay: { setData } },
        timesheets: {
          open: { invalidate: invalidateOpen },
          list: { invalidate: invalidateList },
        },
      },
    }),
    v1: {
      // The field surface's only settings read — punch clock vs sheet. Defaults on.
      settings: { fieldToggles: { useQuery: () => ({ data: { timesheetClock: true } }) } },
      timesheets: { list: { useQuery: () => ({ data: { items: [] }, isFetched: true, isError: false }) } },
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
        setVisitEnroute: {
          useMutation: (opts: typeof enrouteOpts) => {
            enrouteOpts = opts;
            return { mutate: enrouteMutate, isPending: false };
          },
        },
        setVisitStatus: {
          useMutation: (opts: typeof visitStatusOpts) => {
            visitStatusOpts = opts;
            return { mutate: visitStatusMutate, isPending: false };
          },
        },
        day: { useQuery: () => ({ ...dayQueryState, refetch: dayRefetch }) },
        standardDay: { useQuery: () => ({ data: standardDayData, isLoading: false }) },
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
vi.mock("@/lib/store/app-store", () => ({
  useOpenModal: () => openModal,
  usePushModal: () => pushModal,
  useAppStore: (sel: (s: { adoptJob: typeof adoptJobSpy }) => unknown) => sel({ adoptJob: adoptJobSpy }),
}));
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
    fireEvent.click(screen.getByRole("button", { name: "Arrived" }));

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
    expect(screen.getByRole("button", { name: "Arrived" }).hasAttribute("disabled")).toBe(true);
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

  // The clock moved and nothing told it to look again: v1.timesheets.open carries a 15s
  // staleTime, no refetch interval and no focus refetch, so after "Start job" — which server-side
  // closes shop time and opens job time — the card kept showing the OLD segment's since and
  // elapsed until something remounted it.
  it.each([
    ["start", () => startOpts],
    ["complete", () => completeOpts],
  ])("makes the clock card look again after %s", (_name, opts) => {
    render(<MyDayPage />);
    opts().onSuccess?.({ clockNotice: null });
    expect(invalidateOpen).toHaveBeenCalled();
    expect(invalidateList).toHaveBeenCalled();
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
  it("lets a SCHEDULED job be completed without pressing Arrived first", () => {
    render(<MyDayPage />);
    expect(screen.getByRole("button", { name: "Arrived" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(completeMutate).toHaveBeenCalledWith({ jobId: "job-1" });
  });

  it("still moves the card straight to done on that press", () => {
    render(<MyDayPage />);
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
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
    expect(screen.queryByText(/No open jobs assigned to you/i)).toBeNull();

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

    expect(screen.getByText(/No open jobs assigned to you/i)).toBeTruthy();
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

  // The return-trip shape (owenduggan, Aug 11): visit 1 done yesterday noon, visit 2 booked today
  // 9a. "Earliest non-canceled" picked the DONE visit, so the card read yesterday's date and time
  // while the board — correctly — showed today 9a. The visit already worked is history; the card
  // reads the next one to drive to.
  it("shows the NEXT live visit on a half-done job, not the visit already worked", () => {
    // The worked stop carries its real finish stamp — yesterday — so it belongs to the pager's
    // view of yesterday, not to today's glass. Only the return trip renders here.
    withVisits([
      visit({ id: "v1", scheduledDate: "2026-06-30", scheduledStart: "12:00", status: "complete", completedAt: "2026-06-30T19:30:00.000Z" }),
      visit({ id: "v2", scheduledDate: "2026-07-01", scheduledStart: "09:00", status: "pending" }),
    ]);
    render(<MyDayPage />);
    // Today's pending visit, printed as today prints: time alone, no day label.
    expect(screen.getByText("9a")).toBeTruthy();
    expect(screen.queryByText("12p")).toBeNull();
    expect(screen.queryByText("Tue 30")).toBeNull();
  });

  it("falls back to the completed visit's time when nothing is left to drive to", () => {
    withVisits([visit({ scheduledDate: "2026-07-01", scheduledStart: "08:00", status: "complete" })]);
    render(<MyDayPage />);
    expect(screen.getByText("8a")).toBeTruthy();
  });

  // The return-trip shape: AddReturnTripUseCase lands the new visit UNPLACED (no date, pending)
  // on a job whose first visit is complete. The card must say the true thing — the return trip
  // has no slot yet — not quietly re-adopt the done visit's stale day and time.
  it("says 'Not scheduled' when the only LIVE visit is unplaced, not the done visit's old slot", () => {
    withVisits([
      visit({ id: "v1", scheduledDate: "2026-06-30", scheduledStart: "12:00", status: "complete", completedAt: "2026-06-30T19:30:00.000Z" }),
      visit({ id: "v2", status: "pending" }),
    ]);
    render(<MyDayPage />);
    expect(screen.getByText("Not scheduled")).toBeTruthy();
    expect(screen.queryByText("12p")).toBeNull();
    expect(screen.queryByText("Tue 30")).toBeNull();
  });

  it("names the gap rather than guessing when the job has no dated visit", () => {
    withVisits([visit({ scheduledStart: "09:00" })]);
    render(<MyDayPage />);
    // "Not scheduled" is colLabel's own word for it — the same one the job sheet's header uses.
    // A bare "—" said nothing, and there is no time to print here either.
    expect(screen.getByText("Not scheduled")).toBeTruthy();
    expect(screen.queryByText("9a")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// WHICH DAY. `v1.field.myDay` returns status IN (scheduled, in_progress) UNCONDITIONALLY, OR'd
// with complete-inside-today — deliberately, because a plumber who did not finish yesterday needs
// that job on the glass (job-repository.ts). The query is right; the PRESENTATION said "Today's
// jobs" over it, and the row printed a time with no date, so yesterday's 8:30a and today's 8:30a
// were the same three characters. Sorting is earliest-first, so the carried-over job is the FIRST
// row on the page.
// ---------------------------------------------------------------------------

describe("My day — which day a row is actually from", () => {
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

  // The pinned clock is 2026-07-01 (vitest.setup.ts).
  it("prints the time ALONE for today — a 'Today' label on every card is noise", () => {
    withVisits([visit({ scheduledDate: "2026-07-01", scheduledStart: "08:30" })]);
    const { container } = render(<MyDayPage />);
    expect(screen.getByText("8:30a")).toBeTruthy();
    // The PAGER says Today (its job); the card's own when-column must not repeat it.
    expect(container.querySelector(".mdc-when .md-day")).toBeNull();
  });

  // THE DEFECT: this row sorts to the top of the list and used to be indistinguishable from the
  // first stop of the morning.
  it("puts the DAY on a job carried over from yesterday", () => {
    withVisits([visit({ scheduledDate: "2026-06-30", scheduledStart: "08:30" })]);
    render(<MyDayPage />);
    expect(screen.getByText("Tue 30")).toBeTruthy();
    expect(screen.getByText("8:30a")).toBeTruthy();
  });

  // The other direction the same predicate allows, which nobody had considered: an open job the
  // office has already scheduled ahead.
  it("puts the DAY on a job scheduled for a future date", () => {
    withVisits([visit({ scheduledDate: "2026-07-03", scheduledStart: "15:00" })]);
    render(<MyDayPage />);
    expect(screen.getByText("Fri 3")).toBeTruthy();
    expect(screen.getByText("3p")).toBeTruthy();
  });

  // The heading and the empty state described a narrower list than the query returns.
  // The explanatory subtitle was removed entirely — only the plain "My day" heading remains.
  it("the heading names what the list actually holds", () => {
    withVisits([visit({ scheduledDate: "2026-07-01", scheduledStart: "08:30" })]);
    render(<MyDayPage />);
    expect(screen.getByText("My day")).toBeTruthy();
    expect(screen.queryByText("Your open jobs, and what you finished today.")).toBeNull();
    expect(screen.queryByText(/Today's jobs/)).toBeNull();
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

  it("opens from the progress strip, which is not a word anyone typed", () => {
    const { container } = render(<MyDayPage />);
    fireEvent.click(container.querySelector(".mdc-steps")!);
    expect(openModal).toHaveBeenCalledWith(MODAL.TECH_JOB, { jobId: "job-1" });
  });

  // THE REGRESSION. This is the band that swallowed the tap.
  it("opens from the empty strip beside the action buttons", () => {
    const { container } = render(<MyDayPage />);
    const acts = container.querySelector(".fca-row");
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

  // The card is a VISIT now, so its buttons write the visit mutations — the same ones the job
  // sheet uses. Arrived must not also open the sheet.
  it("marks the visit arrived without also opening the sheet", () => {
    render(<MyDayPage />);
    fireEvent.click(screen.getByRole("button", { name: "Arrived" }));
    expect(visitStatusMutate).toHaveBeenCalledWith({ jobId: "job-1", visitId: "visit-1", status: "in_progress" });
    expect(openModal).not.toHaveBeenCalled();
  });

  it("finishes the visit without also opening the sheet", () => {
    render(<MyDayPage />);
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(visitStatusMutate).toHaveBeenCalledWith({ jobId: "job-1", visitId: "visit-1", status: "complete" });
    expect(openModal).not.toHaveBeenCalled();
  });

  it("sends on-my-way from the card", () => {
    // What it deliberately does NOT do — move the card before the send lands — has its own block
    // at the foot of this file.
    render(<MyDayPage />);
    fireEvent.click(screen.getByRole("button", { name: "On my way" }));
    expect(enrouteMutate).toHaveBeenCalledWith({ jobId: "job-1", visitId: "visit-1" });
  });

  it("shows the live On-site-since stamp while the visit is in progress", () => {
    queryState = rowAt({ visits: [visit({ scheduledDate: "2026-08-04", scheduledStart: "08:30", status: "in_progress", startedAt: "2026-07-01T19:38:00.000Z" })] });
    render(<MyDayPage />);
    expect(screen.getByText(/On site · since/)).toBeTruthy();
  });

  it("hides On my way once the tech is on site — a stamp nobody needs anymore", () => {
    queryState = rowAt({ visits: [visit({ scheduledDate: "2026-08-04", scheduledStart: "08:30", status: "in_progress" })] });
    render(<MyDayPage />);
    expect(screen.queryByRole("button", { name: "On my way" })).toBeNull();
    // On site: Done is the one primary left.
    expect(screen.queryByRole("button", { name: "Arrived" })).toBeNull();
    expect(screen.getByRole("button", { name: "Done" })).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// THE DAY PAGER. Paging is a VIEW change: today keeps its live path untouched, a paged day reads
// v1.field.day, and no card on another day offers Arrived/Done — you cannot be en route to
// Thursday. The running clock must survive paging (it is a server row the DayClock renders).
// ---------------------------------------------------------------------------

describe("My day — the day pager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    startPending = false;
    queryState = {
      data: { items: [job({ visits: [visit({ scheduledDate: "2026-07-01", scheduledStart: "08:30" })] })], customers: [] },
      isLoading: false,
      isFetching: false,
    };
    dayQueryState = { data: undefined, isLoading: false, isFetched: false, isError: false };
  });

  it("starts on Today with the date beside it", () => {
    render(<MyDayPage />);
    expect(screen.getByText("Today")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Next day" })).toBeTruthy();
    expect(screen.queryByText("Back to today")).toBeNull();
  });

  it("pages forward to Tomorrow, reads field.day, and offers the way back", () => {
    dayQueryState = {
      data: { items: [job({ visits: [visit({ id: "visit-9", scheduledDate: "2026-07-02", scheduledStart: "10:00" })] })], customers: [] },
      isLoading: false,
      isFetched: true,
      isError: false,
    };
    render(<MyDayPage />);
    fireEvent.click(screen.getByRole("button", { name: "Next day" }));
    expect(screen.getByText("Tomorrow")).toBeTruthy();
    expect(screen.getByText("Back to today")).toBeTruthy();
    // Tomorrow's card offers no state buttons — the sheet handles corrections, the card does not.
    expect(screen.queryByRole("button", { name: "Arrived" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
    expect(screen.queryByRole("button", { name: "On my way" })).toBeNull();
  });

  it("returns to the live today view from Back to today", () => {
    dayQueryState = { data: { items: [], customers: [] }, isLoading: false, isFetched: true, isError: false };
    render(<MyDayPage />);
    fireEvent.click(screen.getByRole("button", { name: "Next day" }));
    fireEvent.click(screen.getByText("Back to today"));
    expect(screen.getByText("Today")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Arrived" })).toBeTruthy();
  });

  it("adopts a paged day's jobs into the store so the sheet can open them", () => {
    dayQueryState = {
      data: { items: [job({ id: "job-far", visits: [visit({ scheduledDate: "2026-07-02" })] })], customers: [] },
      isLoading: false,
      isFetched: true,
      isError: false,
    };
    render(<MyDayPage />);
    fireEvent.click(screen.getByRole("button", { name: "Next day" }));
    expect(adoptJobSpy).toHaveBeenCalled();
  });

  it("names an empty past day honestly", () => {
    dayQueryState = { data: { items: [], customers: [] }, isLoading: false, isFetched: true, isError: false };
    render(<MyDayPage />);
    fireEvent.click(screen.getByRole("button", { name: "Previous day" }));
    expect(screen.getByText("Yesterday")).toBeTruthy();
    expect(screen.getByText("Nothing ran this day.")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// THE MONEY SLOT. A finished card must say where the money stands without opening the sheet:
// Take payment (filled $ circle → the close-out sheet, which finds or mints the job's invoice
// from the jobId), Paid ✓ with the ledger's figure, or Sent to the office. A voided bill keeps
// the job's one invoice slot, so the card offers nothing.
// ---------------------------------------------------------------------------

describe("My day — the finished card's money slot", () => {
  const doneVisit = () =>
    visit({ status: "complete", completedAt: "2026-07-01T20:00:00.000Z", scheduledDate: "2026-07-01", scheduledStart: "08:30" });
  const finishedJob = (over: Record<string, unknown> = {}) =>
    job({ status: "complete", visits: [doneVisit()], ...over });
  const withJob = (j: unknown) => {
    queryState = { data: { items: [j], customers: [] }, isLoading: false, isFetching: false };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    startPending = false;
  });

  it("offers Take payment with the job's figure when nothing is billed yet", () => {
    withJob(finishedJob({ total: { cents: 184500, currency: "USD" }, bill: null }));
    render(<MyDayPage />);
    expect(screen.getByRole("button", { name: "Take payment · $1,845.00" })).toBeTruthy();
  });

  it("pushes the close-out sheet from the jobId alone — it finds or mints the invoice itself", () => {
    withJob(finishedJob({ bill: null }));
    render(<MyDayPage />);
    fireEvent.click(screen.getByRole("button", { name: "Take payment" }));
    // "field-job" is the close-out's return-to-My-day contract (where Done lands) — the card
    // rides the same sentinel the job sheet declares, never a lookalike the modal ignores.
    expect(pushModal).toHaveBeenCalledWith(MODAL.CLOSE_OUT, { jobId: "job-1", from: "field-job" });
    // A money tap is not a card tap — the sheet opens INSTEAD of the job modal, not behind it.
    expect(openModal).not.toHaveBeenCalled();
  });

  it("shows Paid with the ledger's own figure once the bill is paid", () => {
    withJob(finishedJob({ bill: { status: "paid", amountPaid: { cents: 41200, currency: "USD" } } }));
    render(<MyDayPage />);
    expect(screen.getByText("Paid ✓ · $412.00")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Take payment/ })).toBeNull();
  });

  it("shows Paid without a figure for a redacted tech — paid is a fact, the amount is a price", () => {
    withJob(finishedJob({ bill: { status: "paid", amountPaid: null } }));
    render(<MyDayPage />);
    expect(screen.getByText("Paid ✓")).toBeTruthy();
  });

  it("says Sent to the office ONLY when the office was actually asked to bill", () => {
    withJob(finishedJob({ bill: null, invRequested: true }));
    render(<MyDayPage />);
    expect(screen.getByText("Sent to the office")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Take payment/ })).toBeNull();
  });

  it("keeps a SENT bill collectible — the close-out sends as a step of taking payment", () => {
    // Interrupted close-out: invoice auto-sent, card declined, tech pulled away. The card must
    // still offer the door money, exactly as the sheet's own foot would.
    withJob(finishedJob({ total: { cents: 90000, currency: "USD" }, bill: { status: "sent", amountPaid: { cents: 0, currency: "USD" } } }));
    render(<MyDayPage />);
    expect(screen.getByRole("button", { name: "Take payment · $900.00" })).toBeTruthy();
    expect(screen.queryByText("Sent to the office")).toBeNull();
  });

  it("offers the REMAINING balance on a partial payment", () => {
    withJob(finishedJob({ total: { cents: 90000, currency: "USD" }, bill: { status: "partial", amountPaid: { cents: 40000, currency: "USD" } } }));
    render(<MyDayPage />);
    expect(screen.getByRole("button", { name: "Take payment · $500.00" })).toBeTruthy();
  });

  it("offers nothing on a voided bill — the invoice slot is spent", () => {
    withJob(finishedJob({ bill: { status: "void", amountPaid: null } }));
    render(<MyDayPage />);
    expect(screen.queryByRole("button", { name: /Take payment/ })).toBeNull();
    expect(screen.queryByText(/Paid/)).toBeNull();
    expect(screen.queryByText("Sent to the office")).toBeNull();
  });

  it("keeps the Receipt link beside Paid — the close-out is the receipt surface", () => {
    withJob(finishedJob({ bill: { status: "paid", amountPaid: { cents: 41200, currency: "USD" } } }));
    render(<MyDayPage />);
    fireEvent.click(screen.getByRole("button", { name: "Receipt" }));
    expect(pushModal).toHaveBeenCalledWith(MODAL.CLOSE_OUT, { jobId: "job-1", from: "field-job" });
    expect(openModal).not.toHaveBeenCalled();
  });

  it("shows the figure the office was sent with beside the office chip", () => {
    withJob(finishedJob({ total: { cents: 26850, currency: "USD" }, bill: null, invRequested: true }));
    render(<MyDayPage />);
    expect(screen.getByText("Sent to the office")).toBeTruthy();
    expect(screen.getByText("$268.50")).toBeTruthy();
  });

  it("offers no money on a finished STOP whose JOB still has a trip to run", () => {
    // Visit done, job open (the return-trip shape): the close-out would refuse an open job,
    // so the card must not offer what the sheet will bounce.
    withJob(job({
      status: "in_progress",
      total: { cents: 184500, currency: "USD" },
      visits: [
        doneVisit(),
        visit({ status: "pending", scheduledDate: null, scheduledStart: null }),
      ],
    }));
    render(<MyDayPage />);
    expect(screen.queryByRole("button", { name: /Take payment/ })).toBeNull();
    expect(screen.queryByText(/Paid/)).toBeNull();
  });

  it("puts no money slot on a live card — collecting happens after Done", () => {
    withJob(job({ visits: [visit({ scheduledDate: "2026-07-01", scheduledStart: "08:30" })], total: { cents: 184500, currency: "USD" } }));
    render(<MyDayPage />);
    expect(screen.queryByRole("button", { name: /Take payment/ })).toBeNull();
  });
});

/**
 * THE 45 CENTS. The same balance was formatted two ways on the one path where a person hands over
 * cash: the card rounded to whole dollars (fmt$) and the close-out that opens from it printed the
 * exact figure (fmt$2). A $123.45 balance read "$123" on the card, and a technician who collected
 * what the card said was short — every time, on every job that is not a round number.
 */
describe("My day — the figure on the card is the figure at the door", () => {
  const doneVisit = () =>
    visit({ status: "complete", completedAt: "2026-07-01T20:00:00.000Z", scheduledDate: "2026-07-01", scheduledStart: "08:30" });
  const finishedJob = (over: Record<string, unknown> = {}) =>
    job({ status: "complete", visits: [doneVisit()], ...over });
  const withJob = (j: unknown) => {
    queryState = { data: { items: [j], customers: [] }, isLoading: false, isFetching: false };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    startPending = false;
  });

  it("asks for the exact balance, not a rounded one", () => {
    withJob(finishedJob({ total: { cents: 12345, currency: "USD" }, bill: null }));
    render(<MyDayPage />);
    expect(screen.getByRole("button", { name: "Take payment · $123.45" })).toBeTruthy();
  });

  it("subtracts a part payment to the cent", () => {
    withJob(
      finishedJob({
        total: { cents: 20000, currency: "USD" },
        bill: { status: "sent", amountPaid: { cents: 7555, currency: "USD" } },
      }),
    );
    render(<MyDayPage />);
    expect(screen.getByRole("button", { name: "Take payment · $124.45" })).toBeTruthy();
  });

  it("states what was actually taken on the paid chip", () => {
    withJob(finishedJob({ bill: { status: "paid", amountPaid: { cents: 41250, currency: "USD" } } }));
    render(<MyDayPage />);
    expect(screen.getByText("Paid ✓ · $412.50")).toBeTruthy();
  });
});

/**
 * ON MY WAY IS A TEXT TO A THIRD PARTY. Every other tap on this card asserts a local state change;
 * this one asserts that the customer was told. The optimistic patch removed the button on the tap,
 * so a request the phone never finished sending — backgrounded, reloaded, out of signal — left a
 * card that said the text had gone with nothing behind it, and the toast that would have said
 * otherwise died with the page that was reloading.
 */
describe("My day — On my way claims nothing until the server says it sent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    startPending = false;
    queryState = {
      data: { items: [job({ visits: [visit({ scheduledDate: "2026-07-01", scheduledStart: "08:30" })] })], customers: [] },
      isLoading: false,
      isFetching: false,
    };
  });

  it("does not patch the card as en route before the send is confirmed", () => {
    render(<MyDayPage />);
    fireEvent.click(screen.getByRole("button", { name: "On my way" }));
    expect(enrouteMutate).toHaveBeenCalledWith({ jobId: "job-1", visitId: "visit-1" });
    expect(enrouteOpts.onMutate).toBeUndefined();
    expect(setData).not.toHaveBeenCalled();
  });

  it("retries the tap — the endpoint is idempotent and the truck is between cells", () => {
    render(<MyDayPage />);
    expect(enrouteOpts.retry).toBeDefined();
  });
});
