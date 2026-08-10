/**
 * The agenda row's visit reading. The bug it exists for: a two-stop job whose first stop was
 * finished hours ago rendered "SCHEDULED · Start job", because the row asked the JOB status and
 * the job is genuinely still open until the return trip runs.
 */
import { describe, it, expect } from "vitest";
import {
  visitProgress,
  progressPill,
  progressNote,
  canOfferStart,
  type ProgressVisit,
} from "./visit-progress";

const v = (status: string, scheduledDate: string | null = "2026-08-10"): ProgressVisit => ({
  status,
  scheduledDate,
});

/** The screenshot: stop one ran, the return trip has no time yet. */
const RETURN_TRIP_JOB = [v("complete"), v("pending", null)];

describe("visitProgress", () => {
  it("counts the finished visits against the ones that still count", () => {
    const p = visitProgress(RETURN_TRIP_JOB);
    expect(p).toMatchObject({ done: 1, total: 2, partly: true, awaitingSlot: true });
  });

  it("ignores canceled visits in both counts — a called-off stop is not work anybody owes", () => {
    const p = visitProgress([v("complete"), v("canceled"), v("pending", null)]);
    expect(p.done).toBe(1);
    expect(p.total).toBe(2);
  });

  it("a job that has not started is not partly done", () => {
    expect(visitProgress([v("pending"), v("pending")]).partly).toBe(false);
  });

  it("a fully finished job is not partly done either", () => {
    const p = visitProgress([v("complete"), v("complete")]);
    expect(p.partly).toBe(false);
    expect(p.awaitingSlot).toBe(false);
  });

  it("a DATED second stop is not awaiting a slot", () => {
    expect(visitProgress([v("complete"), v("pending", "2026-08-12")]).awaitingSlot).toBe(false);
  });
});

describe("progressPill", () => {
  it("names the return trip when that is literally what is outstanding", () => {
    expect(progressPill(visitProgress(RETURN_TRIP_JOB))).toBe("Return trip");
  });

  it("keeps the job-status pill when the next stop already has a date", () => {
    // Mid-run, not waiting on anything — the schedule already says when.
    expect(progressPill(visitProgress([v("complete"), v("pending", "2026-08-12")]))).toBeNull();
  });

  it("keeps the job-status pill on an untouched job", () => {
    expect(progressPill(visitProgress([v("pending"), v("pending", null)]))).toBeNull();
  });
});

describe("progressNote", () => {
  it("reports the count once some of a multi-visit job is done", () => {
    expect(progressNote(visitProgress(RETURN_TRIP_JOB))).toBe("1 of 2 visits done");
  });

  it("says nothing on a one-visit job — the status pill already carries it", () => {
    expect(progressNote(visitProgress([v("complete")]))).toBeNull();
  });

  it("says nothing before anything is finished", () => {
    expect(progressNote(visitProgress([v("pending"), v("pending")]))).toBeNull();
  });
});

describe("canOfferStart", () => {
  it("withdraws Start job once a visit has finished", () => {
    expect(canOfferStart(visitProgress(RETURN_TRIP_JOB))).toBe(false);
  });

  it("keeps it on a job nobody has been out to yet", () => {
    expect(canOfferStart(visitProgress([v("pending"), v("pending")]))).toBe(true);
  });
});
