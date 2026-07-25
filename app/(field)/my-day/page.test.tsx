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
let queryState: { data: unknown; isLoading: boolean; isFetching: boolean };
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

const job = (over: Record<string, unknown> = {}) => ({
  id: "job-1",
  num: "JOB-1011",
  title: "random job",
  status: "scheduled",
  scheduledStart: null,
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
