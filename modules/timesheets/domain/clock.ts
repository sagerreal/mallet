import type { Result, ValidationError } from "@mallet/shared/types";
import { validation, ok, err } from "@mallet/shared/types";

/**
 * The state a running clock can be in. These are exactly the existing `time_entries.kind`
 * values — the clock is a writer for the same rows the timesheet renders and approves, so a
 * state that isn't a kind would produce hours nobody can read or bill.
 */
export type ClockState = "shop" | "travel" | "job" | "break";

/** The taps a technician can make. One tap = at most one close + at most one open. */
export type ClockTap =
  | "start_day"
  | "enroute"
  | "arrived"
  | "done"
  | "break"
  | "end_break"
  | "end_day";

/** The single running (un-ended) entry for a technician, or the absence of one. */
export interface OpenEntry {
  readonly id: string;
  readonly kind: ClockState;
  readonly jobId: string | null;
  readonly startedAt: Date;
}

export interface ClockPlan {
  readonly close: { readonly id: string; readonly endedAt: Date } | null;
  readonly open: { readonly kind: ClockState; readonly jobId: string | null; readonly startedAt: Date } | null;
  /** True when the tap is a no-op — the caller must write NOTHING. */
  readonly noop: boolean;
  /** Set when the closed segment would be zero-length and is therefore discarded rather than closed. */
  readonly discardOpen?: boolean;
}

const TAPS: readonly ClockTap[] = [
  "start_day",
  "enroute",
  "arrived",
  "done",
  "break",
  "end_break",
  "end_day",
];

const isTap = (v: ClockTap): boolean => TAPS.includes(v);

// Taps that name a job. Without a job the segment cannot be attributed to job cost, which is
// the entire reason travel and on-site time are tracked separately.
const TAPS_REQUIRING_JOB: readonly ClockTap[] = ["enroute", "arrived"];

// Taps that describe time belonging to no job. A jobId arriving with one of these means the
// caller wired the wrong button; accepting it silently would hide that bug in job costing.
const TAPS_FORBIDDING_JOB: readonly ClockTap[] = ["start_day", "break", "end_day"];

// `done` and `end_break` are deliberately in neither list: the natural call site (a Done
// button on a job card) knows the job and will pass it, and refusing that adds a failure mode
// with no upside — the job is read from the OPEN entry being closed, never from the argument.

// Minutes are the resolution timesheets are edited, approved and billed at, so anything
// shorter than a minute is not a segment worth a row.
const MS_PER_MINUTE = 60_000;

// A tap writes nothing at all: a double-tapped button, or ending something already ended.
const NOOP: ClockPlan = Object.freeze({ close: null, open: null, noop: true });

/** What a tap wants the clock to be afterwards. `null` means "run nothing" (end of day). */
interface Segment {
  readonly kind: ClockState;
  readonly jobId: string | null;
}

const SHOP: Segment = Object.freeze({ kind: "shop", jobId: null });
const BREAK: Segment = Object.freeze({ kind: "break", jobId: null });

const targetFor = (tap: ClockTap, jobId: string | null): Segment | null => {
  switch (tap) {
    case "start_day":
      return SHOP;
    case "enroute":
      return { kind: "travel", jobId };
    case "arrived":
      return { kind: "job", jobId };
    // Finishing a job and finishing a break both resume unassigned shop time. Carrying the job
    // forward would invent job-cost minutes nobody confirmed the tech spent on that job — and
    // after a break, guessing they went back to the same job is exactly that invention.
    case "done":
    case "end_break":
      return SHOP;
    case "break":
      return BREAK;
    case "end_day":
      return null;
  }
};

const isValidDate = (v: Date): boolean => v instanceof Date && !Number.isNaN(v.getTime());

const namesAJob = (jobId: string | null): boolean => typeof jobId === "string" && jobId.trim() !== "";

// Boundary validation. Returns the reason the arguments cannot be planned, or null if they can.
const rejectArgs = (tap: ClockTap, open: OpenEntry | null, at: Date, jobId: string | null): ValidationError | null => {
  if (!isTap(tap)) return validation(`unknown tap: "${tap}"`, "tap");
  if (!isValidDate(at)) return validation("tap time is not a valid date", "at");
  if (open !== null && !isValidDate(open.startedAt)) {
    return validation("open entry has an invalid startedAt", "open.startedAt");
  }
  if (TAPS_REQUIRING_JOB.includes(tap) && !namesAJob(jobId)) {
    return validation(`${tap} requires a jobId`, "jobId");
  }
  if (TAPS_FORBIDDING_JOB.includes(tap) && namesAJob(jobId)) {
    return validation(`${tap} must not carry a jobId`, "jobId");
  }
  return null;
};

const inSameMinute = (a: Date, b: Date): boolean =>
  Math.floor(a.getTime() / MS_PER_MINUTE) === Math.floor(b.getTime() / MS_PER_MINUTE);

// Nothing is running. Most taps just start the segment they name, so the morning punch costs
// zero setup taps: "on my way" on the first job of the day opens travel by itself.
const planFromIdle = (tap: ClockTap, target: Segment | null, at: Date): ClockPlan => {
  // Ending a day or a break that isn't running is what the tech means by a second tap on the
  // same button, and a failure toast there reads as "the app lost my hours".
  if (target === null || tap === "end_break") return NOOP;
  return { close: null, open: { ...target, startedAt: at }, noop: false };
};

const isAlreadyIn = (open: OpenEntry, target: Segment): boolean =>
  open.kind === target.kind && open.jobId === target.jobId;

/**
 * Decide what a tap does. Pure and total: every (tap, state) pair yields a plan or an explicit
 * validation error, never a throw — the caller runs this inside the transaction of a dispatch
 * action a customer is waiting on, so a throw here would fail the dispatch.
 *
 * The returned plan is the whole write: close at most one row, open at most one row.
 */
export const planTap = (
  tap: ClockTap,
  open: OpenEntry | null,
  at: Date,
  jobId: string | null,
): Result<ClockPlan, ValidationError> => {
  const rejection = rejectArgs(tap, open, at, jobId);
  if (rejection !== null) return err(rejection);

  const target = targetFor(tap, jobId);
  if (open === null) return ok(planFromIdle(tap, target, at));

  // The caller clamps device timestamps; the domain does not trust that it did. A tap before
  // the open segment started cannot be turned into hours, so it is refused rather than guessed.
  if (at.getTime() < open.startedAt.getTime()) {
    return err(validation("tap time is before the running entry started", "at"));
  }

  // Double-tapped button: already in the requested state for the same job. Writing here would
  // split one real segment into two rows that each look like separate work.
  if (target !== null && isAlreadyIn(open, target)) return ok(NOOP);

  // Zero-length collapse: the tap landed inside the minute the open segment started, so that
  // segment never happened. Discard its row and start the new state at the original instant —
  // this is what stops six Dones tapped at 6pm from the truck leaving five junk rows.
  if (inSameMinute(at, open.startedAt)) {
    return ok({
      close: null,
      open: target === null ? null : { ...target, startedAt: open.startedAt },
      noop: false,
      discardOpen: true,
    });
  }

  return ok({
    close: { id: open.id, endedAt: at },
    open: target === null ? null : { ...target, startedAt: at },
    noop: false,
  });
};
