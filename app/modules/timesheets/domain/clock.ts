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

/** Everything a tap decision depends on. An object, not positional args — five of those read badly. */
export interface TapInput {
  readonly tap: ClockTap;
  /** The running entry, or null/undefined when the clock is idle. */
  readonly open: OpenEntry | null | undefined;
  /** When the tap happened, per the device. Bounded against `now` — never trusted outright. */
  readonly at: Date;
  readonly jobId: string | null;
  /** Server time. A parameter, never read from the system clock, so this module stays pure. */
  readonly now: Date;
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

// Compared by identity against the frozen list rather than by string coercion: an unknown `tap`
// may be any runtime value, and a Symbol throws on interpolation — so the very guard whose job is
// to reject junk must never stringify what it was handed.
const isTap = (v: unknown): v is ClockTap => TAPS.includes(v as ClockTap);

// Taps that name a job. Without a job the segment cannot be attributed to job cost, which is
// the entire reason travel and on-site time are tracked separately.
const TAPS_REQUIRING_JOB: readonly ClockTap[] = ["enroute", "arrived"];

// Taps that describe time belonging to no job. A jobId arriving with one of these means the
// caller wired the wrong button; accepting it silently would hide that bug in job costing.
const TAPS_FORBIDDING_JOB: readonly ClockTap[] = ["start_day", "break", "end_day"];

// Taps that may START the clock from idle. The others are EXIT taps — they end something. A stray
// Done or End break with nothing running is a mis-tap, and opening a segment for it would put the
// technician back on the clock hours after they went home, silently, with the row looking finished
// enough to approve and push to payroll.
const TAPS_THAT_MAY_AUTO_OPEN: readonly ClockTap[] = ["start_day", "enroute", "arrived", "break"];

// `done` and `end_break` are deliberately in neither job list: the natural call site (a Done
// button on a job card) knows the job and will pass it, and refusing that adds a failure mode
// with no upside — the job is read from the OPEN entry being closed, never from the argument.

// Minutes are the resolution timesheets are edited, approved and billed at, so anything
// shorter than a minute is not a segment worth a row.
const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;

/**
 * How long a single unbroken segment can plausibly run. Not a shift — one continuous stretch with
 * no tap of any kind. Past this the segment is stale (an End day nobody tapped), and Start day the
 * next morning re-anchors the clock instead of no-op'ing into it. Without this a Friday-evening
 * forgotten punch quietly absorbs the whole weekend and bills it.
 */
export const MAX_OPEN_SEGMENT_MS = 12 * MS_PER_HOUR;

/**
 * How far ahead of server time a device tap may claim to be. Phone clocks drift and a tap can be
 * retried; beyond this the timestamp is wrong rather than skewed, and accepting it would open a
 * segment in the future that no later tap can close.
 */
export const MAX_FUTURE_SKEW_MS = 5 * MS_PER_MINUTE;

/**
 * How far behind server time a tap may claim to be. Generous, because a tap made with no signal in
 * a crawlspace is retried when the van reaches the road — but bounded, so a device with a wrong
 * date cannot open a day six years in the past.
 */
export const MAX_BACKDATE_MS = 24 * MS_PER_HOUR;

/**
 * A tap timestamped fractionally BEFORE the segment it closes is ordinary clock skew between two
 * requests, not a real backwards tap: the same skew a moment later collapses harmlessly into the
 * zero-length rule. Within this window the tap is clamped to the segment start; beyond it, refused.
 */
export const MAX_BACKWARDS_SKEW_MS = MS_PER_MINUTE;

// A tap writes nothing at all: a double-tapped button, an exit tap with nothing running, or a tap
// whose only effect would be to destroy attribution the technician did not ask to destroy.
const NOOP: ClockPlan = Object.freeze({ close: null, open: null, noop: true });

/** What a tap wants the clock to be afterwards. `null` means "run nothing" (end of day). */
interface Segment {
  readonly kind: ClockState;
  readonly jobId: string | null;
}

const SHOP: Segment = Object.freeze({ kind: "shop", jobId: null });
const BREAK: Segment = Object.freeze({ kind: "break", jobId: null });

/**
 * What the tap does to the SHIFT — the lane that pays.
 *
 * On my way and Arrived are absent on purpose: they name a job, and a job is not a slice of the
 * shift. They open a row in the costing lane (jobTargetFor) and leave the shift running underneath,
 * because a technician on a job is on the clock AND on that job — one fact about one hour, not two
 * hours. From idle they still open the shift, so the morning punch costs no extra tap.
 */
const targetFor = (tap: ClockTap, jobId: string | null): Segment | null => {
  switch (tap) {
    case "start_day":
      return SHOP;
    // ON MY WAY STARTS THE JOB. Driving to a job is a cost OF that job — the truck rolling to the
    // customer's house is time the shop pays for and the job caused. Splitting it into its own
    // state made a fourth thing to explain, kept drive time out of job costing, and put a seam in
    // the middle of one continuous stretch of work.
    //
    // `arrived` targets the same segment, so isAlreadyIn() makes it a NO-OP: one job row runs from
    // the moment he sets off. The visit still records enroute_at separately, so when he left and
    // when he got there is not lost — it is just not a separate KIND of paid time.
    // The shift is unaffected: it is already running, and the costing lane takes the job.
    case "enroute":
    case "arrived":
      return SHOP;
    // Done closes the JOB, not the shift — he is still on the clock, just no longer on that job.
    // End break resumes the shift itself.
    case "done":
    case "end_break":
      return SHOP;
    case "break":
      return BREAK;
    case "end_day":
      return null;
  }
};

/**
 * What the tap does to the COSTING lane — the job row that runs beside the shift.
 *
 * `null` means leave it exactly as it is; `CLOSE_JOB` means end it and open nothing.
 *
 * Break closes the job: a man on his lunch is not on the job, and leaving it open would charge the
 * customer for his sandwich. End day closes it for the obvious reason.
 */
export const CLOSE_JOB = Symbol("close-job");

export const jobTargetFor = (tap: ClockTap, jobId: string | null): Segment | typeof CLOSE_JOB | null => {
  switch (tap) {
    case "enroute":
    case "arrived":
      return { kind: "job", jobId };
    case "done":
    case "break":
    case "end_day":
      return CLOSE_JOB;
    // Starting the day, or coming back from lunch, says nothing about a job.
    case "start_day":
    case "end_break":
      return null;
  }
};

const isValidDate = (v: unknown): v is Date => v instanceof Date && !Number.isNaN(v.getTime());

const namesAJob = (jobId: string | null): boolean => typeof jobId === "string" && jobId.trim() !== "";

// Boundary validation. Returns the reason the arguments cannot be planned, or null if they can.
const rejectArgs = (input: TapInput): ValidationError | null => {
  const { tap, open, at, jobId, now } = input;
  // Never interpolate `tap` — see isTap.
  if (!isTap(tap)) return validation("unknown tap", "tap");
  if (!isValidDate(at)) return validation("tap time is not a valid date", "at");
  if (!isValidDate(now)) return validation("server time is not a valid date", "now");
  // `open == null` covers undefined too. A repository that forgets `row ? toDomain(row) : null`
  // hands back undefined, and dereferencing it here would throw inside a dispatch transaction.
  if (open != null && !isValidDate(open.startedAt)) {
    return validation("open entry has an invalid startedAt", "open.startedAt");
  }
  if (TAPS_REQUIRING_JOB.includes(tap) && !namesAJob(jobId)) {
    return validation(`${tap} requires a jobId`, "jobId");
  }
  if (TAPS_FORBIDDING_JOB.includes(tap) && namesAJob(jobId)) {
    return validation(`${tap} must not carry a jobId`, "jobId");
  }
  // Bound the device timestamp in BOTH directions, on every path including auto-open. Time is the
  // only input here that becomes money.
  if (at.getTime() > now.getTime() + MAX_FUTURE_SKEW_MS) {
    return validation("tap time is too far in the future", "at");
  }
  if (at.getTime() < now.getTime() - MAX_BACKDATE_MS) {
    return validation("tap time is too far in the past", "at");
  }
  return null;
};

const inSameMinute = (a: Date, b: Date): boolean =>
  Math.floor(a.getTime() / MS_PER_MINUTE) === Math.floor(b.getTime() / MS_PER_MINUTE);

const isStale = (open: OpenEntry, at: Date): boolean =>
  at.getTime() - open.startedAt.getTime() > MAX_OPEN_SEGMENT_MS;

// Nothing is running. Only the taps that MEAN "I am starting something" may open a segment; the
// exit taps are no-ops. The morning punch still costs zero taps, because On my way on the first
// job of the day opens travel by itself.
const planFromIdle = (tap: ClockTap, target: Segment | null, at: Date): ClockPlan => {
  if (target === null || !TAPS_THAT_MAY_AUTO_OPEN.includes(tap)) return NOOP;
  return { close: null, open: { ...target, startedAt: at }, noop: false };
};

const isAlreadyIn = (open: OpenEntry, target: Segment): boolean =>
  open.kind === target.kind && open.jobId === target.jobId;

/**
 * Taps that must NOT act on the currently-running segment, because doing so would silently destroy
 * attribution the technician never asked to lose:
 *
 * - Start day mid-job would close real job time and reopen it as unattributed shop time. Someone
 *   re-tapping a stale Today screen should not cost the job its costing.
 * - End break while no break is running would do the same to a job or travel segment.
 *
 * Both are mis-taps, and the honest response to a mis-tap is to do nothing.
 */
const isDestructiveMistap = (tap: ClockTap, open: OpenEntry, at: Date): boolean => {
  if (tap === "start_day") {
    // The exception: a segment stale enough to be a forgotten End day SHOULD be re-anchored — that
    // is the Monday-morning recovery path, and refusing it would leave the weekend on the clock.
    if (isStale(open, at)) return false;
    return open.kind !== "shop";
  }
  if (tap === "end_break") return open.kind !== "break";
  return false;
};

/**
 * Decide what a tap does. Pure and total: every (tap, state) pair yields a plan or an explicit
 * validation error, never a throw — the caller runs this inside the transaction of a dispatch
 * action a customer is waiting on, so a throw here would fail the dispatch.
 *
 * The returned plan is the whole write: close at most one row, open at most one row.
 */
export const planTap = (input: TapInput): Result<ClockPlan, ValidationError> => {
  const rejection = rejectArgs(input);
  if (rejection !== null) return err(rejection);

  const { tap, jobId } = input;
  // Normalised once so no branch below can dereference undefined.
  const open: OpenEntry | null = input.open ?? null;
  const target = targetFor(tap, jobId);

  if (open === null) return ok(planFromIdle(tap, target, input.at));

  // Sub-minute backwards skew between two requests is clamped rather than refused; a genuinely
  // backwards tap cannot be turned into hours and is refused rather than guessed.
  const startedMs = open.startedAt.getTime();
  const rawMs = input.at.getTime();
  if (rawMs < startedMs - MAX_BACKWARDS_SKEW_MS) {
    return err(validation("tap time is before the running entry started", "at"));
  }
  const at = rawMs < startedMs ? open.startedAt : input.at;

  if (isDestructiveMistap(tap, open, at)) return ok(NOOP);

  // Double-tapped button: already in the requested state for the same job. Writing here would
  // split one real segment into two rows that each look like separate work. A STALE segment is
  // excluded — re-anchoring it is the whole point of the recovery path.
  if (target !== null && isAlreadyIn(open, target) && !isStale(open, at)) return ok(NOOP);

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
