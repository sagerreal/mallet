import { describe, it, expect } from "vitest";

/**
 * The mapping from a submission row to what the technician's screen shows.
 *
 * Extracted from the hook so it can be asserted without a React tree — the branch that matters is
 * three booleans deep and is the difference between a man knowing why his week came back and being
 * left to guess.
 */
type Row = { submittedAt: string; reopenedAt: string | null; reopenReason: string | null } | null;

const view = (submission: Row) => ({
  submitted: submission !== null && submission.reopenedAt === null,
  changesRequested:
    submission !== null && submission.reopenedAt !== null ? submission.reopenReason : null,
});

const SUBMITTED = "2026-08-13T18:00:00.000Z";
const REOPENED = "2026-08-14T09:00:00.000Z";

describe("what the technician's week says about itself", () => {
  it("never submitted: no attestation, nothing to explain", () => {
    expect(view(null)).toEqual({ submitted: false, changesRequested: null });
  });

  it("submitted and standing: locked, and no request outstanding", () => {
    expect(view({ submittedAt: SUBMITTED, reopenedAt: null, reopenReason: null })).toEqual({
      submitted: true,
      changesRequested: null,
    });
  });

  it("sent back by the office: unlocked, AND it says why", () => {
    // Without the reason a returned week is indistinguishable from one he never submitted — the
    // Submit button just reappears and he is left to work out what changed.
    expect(
      view({ submittedAt: SUBMITTED, reopenedAt: REOPENED, reopenReason: "Wednesday never clocked out" }),
    ).toEqual({ submitted: false, changesRequested: "Wednesday never clocked out" });
  });

  it("reopened by his own clock tap: unlocked, and no reason is invented", () => {
    // Tapping Start day on a submitted week reopens it deliberately — the clock must never refuse.
    // That is not the office asking for anything, so nothing is claimed.
    expect(view({ submittedAt: SUBMITTED, reopenedAt: REOPENED, reopenReason: null })).toEqual({
      submitted: false,
      changesRequested: null,
    });
  });

  it("resubmitted after a request: the reason stops being shown", () => {
    // Once he signs off again the old reason is history; leaving it above the week reads as an
    // outstanding complaint about hours he has just re-attested.
    expect(view({ submittedAt: REOPENED, reopenedAt: null, reopenReason: "old reason" })).toEqual({
      submitted: true,
      changesRequested: null,
    });
  });
});
