// @vitest-environment jsdom
/**
 * components/modals/job-measure-block.realstore.test.tsx
 *
 * Regression test for a live-app crash the mocked-store tests in
 * job-measure-block.test.tsx could not catch: a selector that falls back to a
 * fresh `[]` literal INSIDE the selector body (`s.roomsByJob[jobId] ?? []`)
 * hands useSyncExternalStore a new array reference on every getSnapshot call.
 * React sees the store's snapshot as "changed" on every render and
 * infinite-loops — in a real browser this trips the error boundary
 * ("Something went wrong.") the instant the Measurements accordion opens for
 * a job with no roomsByJob entry yet; under React 18+ testing-library it
 * throws "Maximum update depth exceeded" synchronously from render().
 *
 * A mocked `useAppStore` (`(selector) => selector(fixedObject)`) can't
 * reproduce this: the mock always returns the exact same object reference
 * regardless of what the selector computes, so the loop never triggers. This
 * test uses the REAL zustand store (no mock of @/lib/store/app-store) so the
 * actual useSyncExternalStore subscription path runs, matching how the app
 * mounts JobMeasureBlock via the job modal. Only `useJobRooms` (which hits
 * tRPC/react-query) is mocked, matching job-measure-block.test.tsx.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { useAppStore } from "@/lib/store/app-store";
import { JobMeasureBlock } from "./job-measure-block";

const JOB_ID = "job-real-store-1";

const useJobRoomsMock = vi.fn();

vi.mock("@/features/measurements/use-job-rooms", () => ({
  useJobRooms: (...args: unknown[]) => useJobRoomsMock(...args),
}));

beforeEach(() => {
  // Reset only the measurements slice — the job has NO roomsByJob entry,
  // reproducing the exact seam the bug lived in (`s.roomsByJob[jobId]` is
  // `undefined`, not `[]`).
  useAppStore.setState({ roomsByJob: {} });
  // A settled, successful query with nothing cached — the empty-state branch,
  // not the load-failed branch (that's covered against the real store too,
  // in the test below).
  useJobRoomsMock.mockReset();
  useJobRoomsMock.mockReturnValue({
    isFetched: true,
    isError: false,
    isRefetching: false,
    refetch: vi.fn(),
  });
});

describe("JobMeasureBlock — real zustand store, no roomsByJob entry", () => {
  it("renders the empty state without an infinite re-render loop", () => {
    expect(() => render(<JobMeasureBlock jobId={JOB_ID} />)).not.toThrow();
    expect(screen.getByText("No rooms measured yet.")).toBeTruthy();
    expect(screen.getByText("+ Add room")).toBeTruthy();
  });

  it("renders the load-failed state (not the empty state) against the real store when the query errors", () => {
    useJobRoomsMock.mockReturnValue({
      isFetched: true,
      isError: true,
      isRefetching: false,
      refetch: vi.fn(),
    });

    expect(() => render(<JobMeasureBlock jobId={JOB_ID} />)).not.toThrow();
    expect(screen.getByText("Couldn't load your rooms.")).toBeTruthy();
    expect(screen.queryByText("No rooms measured yet.")).toBeNull();
  });
});
