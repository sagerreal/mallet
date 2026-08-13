import type {
  UserId,
  JobId,
  TimeEntryId,
  Result,
  AppError,
  Clock,
} from "@mallet/shared/types";
import { ok, err, validation } from "@mallet/shared/types";
import type { IdGenerator } from "@mallet/shared/ports";
import { logger } from "@mallet/shared/observability";
import type {
  TimeEntry,
  TimeEntryKind,
  TimeEntrySrc,
  TimeEntryStatus,
} from "../domain/time-entry";
import type { TimeEntryRepository } from "../domain/time-entry-repository";
import {
  planTap,
  MAX_OPEN_SEGMENT_MS,
  type ClockPlan,
  type ClockTap,
  type OpenEntry,
  type ClockState,
} from "../domain/clock";
import {
  toWallClock,
  splitAtMidnight,
  endOfLocalDay,
  type DaySegment,
} from "../domain/wall-clock";

// Every row written here is machine-written from a tap. Recording it as "manual" would claim a
// human typed hours nobody typed — the office reads this column when deciding how much to trust
// an entry it is about to sign for.
const TAP_SRC: TimeEntrySrc = "clock";

// Nothing is ever born approved. Approval is the shop's signature and the only trigger for hours
// leaving Mallet, so a row must pass through a human before it can be pushed to payroll.
const NEW_ENTRY_STATUS: TimeEntryStatus = "draft";

// The note column is NOT NULL and a tap carries no text. The technician can add one afterwards on
// My hours; inventing a note here would put words in his mouth on a payroll record.
const NO_NOTE = "";

export interface SetClockStateCommand {
  readonly techUserId: UserId;
  readonly tap: ClockTap;
  /** The job the tap happened on, for the taps that name one (On my way / Arrived). */
  readonly jobId: JobId | null;
  /**
   * When the tap happened, per the DEVICE — a tap made with no signal is retried when the van
   * reaches the road, and the original moment is what should be recorded. Never trusted outright:
   * `planTap` bounds it against server time in both directions and clamps sub-minute skew.
   */
  readonly at: Date;
}

export interface SetClockStateResult {
  /**
   * True when the tap wrote nothing — a double-tapped button, or an exit tap with nothing running.
   * A no-op is a success: a technician who taps Done twice has not made a mistake worth an error.
   */
  readonly noop: boolean;
  /** The rows this tap finished: the segment it closed, plus any further local days it ran into. */
  readonly closed: readonly TimeEntry[];
  /** The entry now running, or null when the tap ended the day (or changed nothing). */
  readonly opened: TimeEntry | null;
  /**
   * Set when the open segment was thrown away instead of closed (it lasted less than the minute a
   * timesheet is recorded at). The caller is showing that row and must drop it, not end it.
   */
  readonly discardedEntryId: TimeEntryId | null;
  /**
   * True when the closed segment's end had to be CAPPED because it was left running far too long —
   * a forgotten End day. Its hours are a bounded over-estimate, not measured time, so the caller
   * must surface it for correction rather than presenting it as fact.
   */
  readonly boundedClose: boolean;
}

/** A segment ready to start running, already converted to the shop's wall clock. */
interface OpeningRow {
  readonly kind: TimeEntryKind;
  readonly jobId: string | null;
  readonly workDate: string; // YYYY-MM-DD
  readonly startTime: string; // HH:MM
}

/** One segment being finished: the patched row itself, plus the days it ran into after midnight. */
interface ClosingWrite {
  /** The open entry, already patched with its end time — not yet saved. */
  readonly entry: TimeEntry;
  /** Finished rows for each further local day the segment ran into. Empty for an ordinary close. */
  readonly remainder: readonly DaySegment[];
  /**
   * True when the recorded end was CAPPED rather than taken from the tap — i.e. this segment was
   * left running far too long (a forgotten End day). The hours on it are a bounded over-estimate
   * and a human should correct them, so the caller surfaces it rather than passing it off as
   * measured time.
   */
  readonly bounded: boolean;
}

/** Everything a tap will write, resolved and validated BEFORE the first row is written. */
interface PendingWrites {
  /** The open entry, to be soft-deleted rather than closed (the zero-length collapse). */
  readonly discard: TimeEntry | null;
  readonly closing: ClosingWrite | null;
  readonly opening: OpeningRow | null;
}

/**
 * The instant a running row began.
 *
 * `time_entries` records a wall clock (work_date + start_time), not an instant, and turning a wall
 * clock back into an instant needs an inverse of the zone rules that is genuinely ambiguous across
 * a daylight-saving fall-back. `createdAt` needs no inverse and is exact for every row this clock
 * writes: the row is inserted at the moment its segment opens.
 *
 * It is only an approximation for a hand-typed running row (created hours after the work began),
 * and even there it is safe to write from, because closing a segment only ever PATCHES the end
 * time and never rewrites the stored start. The one case where the approximation could file hours
 * on a day nobody worked is caught by the work-date check in `closeRows`.
 */
const startInstantOf = (entry: TimeEntry): Date => entry.props.createdAt;

const toOpenEntry = (entry: TimeEntry): OpenEntry => ({
  id: entry.props.id,
  // A running time-off entry is unconstructible (domain + DB shape check), so an OPEN row's
  // kind is always a clock kind — the narrowing TS cannot see.
  kind: entry.props.kind as ClockState,
  jobId: entry.props.jobId,
  startedAt: startInstantOf(entry),
});

// planTap only ever closes or discards the very entry it was handed, so a null here is a broken
// invariant rather than a user error. Stated instead of assumed: it would mean the plan and the row
// we read have diverged, and writing on a divergence attaches hours to the wrong segment.
const requireOpen = (openEntry: TimeEntry | null): Result<TimeEntry, AppError> =>
  openEntry === null
    ? err(validation("the clock plan acts on an entry that is no longer open", "tap"))
    : ok(openEntry);

const toOpeningRow = (
  open: NonNullable<ClockPlan["open"]>,
  timeZone: string,
): Result<OpeningRow, AppError> => {
  const wall = toWallClock(open.startedAt, timeZone);
  if (!wall.ok) return err(wall.error);
  return ok({
    kind: open.kind,
    jobId: open.jobId,
    workDate: wall.value.workDate,
    startTime: wall.value.hhmm,
  });
};

/**
 * The end instant a close is allowed to record.
 *
 * A forgotten End day used to be closed at the tap instant, and splitAtMidnight then materialised a
 * FULL 00:00->23:59 paid row for every intervening local day: a Monday-evening segment closed by
 * Tuesday morning's first tap billed ~14.5 hours nobody worked, as finished draft rows that passed
 * the unfinished-week guard and would have reached payroll. Two reviewers found it independently.
 *
 * The bound applies ONLY to a segment that is already STALE — one that ran longer than
 * MAX_OPEN_SEGMENT_MS, the longest unbroken stretch a person plausibly works. That distinction is
 * load-bearing: crossing midnight is NOT itself suspicious. The 22:40->00:20 emergency call is the
 * highest-margin job in the plumbing beachhead, it is ~100 minutes, and it must still split cleanly
 * into two rows. Bounding every close at the day boundary would silently delete the after-midnight
 * half of exactly the work the shop most wants to see.
 *
 * When a segment IS stale, its end is capped to the earlier of the end of its own local day and its
 * start plus one maximum stretch. The recorded hours are then a bounded over-estimate rather than an
 * unbounded one — still wrong, but wrong by at most one stretch, on one day, on a single row a human
 * can see and correct. Discarding the segment outright would invent nothing but would lose real
 * worked time, which is the worse trade. `boundedClose` is what the UI flags for correction.
 */
const boundedEnd = (
  startedAt: Date,
  endedAt: Date,
  timeZone: string,
): Result<{ endedAt: Date; bounded: boolean }, AppError> => {
  // Not stale: the tap instant stands, and a midnight crossing splits normally.
  if (endedAt.getTime() - startedAt.getTime() <= MAX_OPEN_SEGMENT_MS) {
    return ok({ endedAt, bounded: false });
  }

  const endOfDay = endOfLocalDay(startedAt, timeZone);
  if (!endOfDay.ok) return err(endOfDay.error);

  const limitMs = Math.min(endOfDay.value.getTime(), startedAt.getTime() + MAX_OPEN_SEGMENT_MS);
  // A stale segment always exceeds the cap by construction, so this is always a real bound.
  return ok({ endedAt: new Date(limitMs), bounded: true });
};

// Close one running segment. A segment that ran past local midnight cannot be one row — the columns
// are a date plus a wall time — so it becomes the closed row plus one finished row per further day.
// After bounding (see boundedEnd) a close can no longer cross midnight, so the remainder is always
// empty in practice; the handling is kept because splitAtMidnight's contract allows it.
const closeRows = (
  entry: TimeEntry,
  endedAt: Date,
  timeZone: string,
  now: Date,
): Result<ClosingWrite, AppError> => {
  const startedAt = startInstantOf(entry);
  const bound = boundedEnd(startedAt, endedAt, timeZone);
  if (!bound.ok) return err(bound.error);

  const rows = splitAtMidnight({ startedAt, endedAt: bound.value.endedAt }, timeZone);
  if (!rows.ok) return err(rows.error);

  const first = rows.value[0];
  if (first === undefined) {
    // splitAtMidnight errors rather than returning an empty array, so this is unreachable — but an
    // unchecked [0] would be `undefined` at runtime if that ever changed, and undefined here would
    // be written as a missing end time on a payroll record.
    return err(validation("the closing segment produced no timesheet row", "endedAt"));
  }

  // The closed row keeps its own recorded date and start; only its end is written. If the split
  // disagrees about which day that row started, the two are describing different segments, and
  // patching an end time across that gap would record hours on a day nobody worked.
  if (first.workDate !== entry.props.workDate) {
    return err(
      validation(
        `The running entry is dated ${entry.props.workDate} but was started on ${first.workDate}. Correct that entry's date on the timesheet, then tap again.`,
        "workDate",
      ),
    );
  }

  const closed = entry.patch({ endTime: first.endTime, running: false }, now);
  if (!closed.ok) return err(closed.error);
  return ok({ entry: closed.value, remainder: rows.value.slice(1), bounded: bound.value.bounded });
};

// Turn a plan of instants into rows of the shop's wall clock. Pure: nothing is written from here,
// so a bad timezone or an unrepresentable segment leaves the timesheet exactly as it was.
const planWrites = (
  plan: ClockPlan,
  openEntry: TimeEntry | null,
  timeZone: string,
  now: Date,
): Result<PendingWrites, AppError> => {
  const opening = plan.open === null ? null : toOpeningRow(plan.open, timeZone);
  if (opening !== null && !opening.ok) return err(opening.error);
  const openingRow = opening === null ? null : opening.value;

  if (plan.discardOpen === true) {
    const entry = requireOpen(openEntry);
    if (!entry.ok) return err(entry.error);
    return ok({ discard: entry.value, closing: null, opening: openingRow });
  }

  if (plan.close === null) {
    return ok({ discard: null, closing: null, opening: openingRow });
  }

  const entry = requireOpen(openEntry);
  if (!entry.ok) return err(entry.error);
  const closing = closeRows(entry.value, plan.close.endedAt, timeZone, now);
  if (!closing.ok) return err(closing.error);

  return ok({ discard: null, closing: closing.value, opening: openingRow });
};

/**
 * Run one clock tap: read what is open, decide (in the pure domain) what the tap does, and write it.
 *
 * Runs inside the CALLER'S transaction — the visit write and the clock write are one unit, so a
 * dispatch action a customer is waiting on can never half-succeed. This use-case therefore opens no
 * transaction of its own and never swallows a failure: a refused tap must roll the whole thing back.
 */
export class SetClockStateUseCase {
  constructor(
    private readonly entries: TimeEntryRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    /**
     * The shop's IANA timezone, supplied BY THE CALLER from org settings. It is a dependency rather
     * than a lookup because timesheets must not import the settings module — and because a wrong
     * value here files a plumber's evening on tomorrow's sheet, so it belongs where it can be seen
     * being injected. An unknown zone is refused by the conversion, never defaulted to UTC.
     */
    private readonly timeZone: string,
  ) {}

  async exec(
    cmd: SetClockStateCommand,
    orgId: string,
  ): Promise<Result<SetClockStateResult, AppError>> {
    // One reading of the clock for the whole tap: planning and writing must not disagree about
    // when "now" was.
    const now = this.clock.now();
    const openEntry = await this.entries.findOpenForTech(cmd.techUserId);

    const plan = planTap({
      tap: cmd.tap,
      open: openEntry === null ? null : toOpenEntry(openEntry),
      at: cmd.at,
      jobId: cmd.jobId,
      now,
    });
    if (!plan.ok) return err(plan.error);

    if (plan.value.noop) {
      return ok({ noop: true, closed: [], opened: null, discardedEntryId: null, boundedClose: false });
    }

    const writes = planWrites(plan.value, openEntry, this.timeZone, now);
    if (!writes.ok) return err(writes.error);

    return ok(await this.write(writes.value, cmd, orgId, now));
  }

  // The write ORDER is load-bearing: the database holds a partial unique index of one running entry
  // per technician, so the open segment must stop running before the next one is inserted.
  private async write(
    writes: PendingWrites,
    cmd: SetClockStateCommand,
    orgId: string,
    now: Date,
  ): Promise<SetClockStateResult> {
    if (writes.discard !== null) {
      // Soft-deleted, not closed: the segment lasted less than the minute a timesheet is recorded
      // at, so it never happened. This is what stops six Dones tapped at 6pm leaving five junk rows.
      await this.entries.remove(writes.discard.props.id, now);
    }
    const closed =
      writes.closing === null ? [] : await this.finishSegment(writes.closing, cmd, orgId);
    const opened =
      writes.opening === null ? null : await this.startSegment(writes.opening, cmd, orgId);

    logger.info(
      {
        orgId,
        techUserId: cmd.techUserId,
        tap: cmd.tap,
        closed: closed.length,
        discarded: writes.discard !== null,
        opened: opened !== null,
        // Logged because a bounded close means a technician forgot to end a day and the hours on
        // that row are an estimate — worth seeing in ops, not only in the UI.
        boundedClose: writes.closing?.bounded ?? false,
      },
      "timeEntry.clockTapped",
    );

    return {
      noop: false,
      closed,
      opened,
      discardedEntryId: writes.discard === null ? null : writes.discard.props.id,
      boundedClose: writes.closing?.bounded ?? false,
    };
  }

  // Save the closed row, then write one finished row per further local day it ran into.
  private async finishSegment(
    closing: ClosingWrite,
    cmd: SetClockStateCommand,
    orgId: string,
  ): Promise<readonly TimeEntry[]> {
    await this.entries.save(closing.entry);

    const source = closing.entry.props;
    const continued: TimeEntry[] = [];
    for (const day of closing.remainder) {
      // A remainder row is the SAME segment continued past midnight, so it carries the same job,
      // kind and note. Anything else would drop the job attribution at the date boundary — and the
      // 10:40pm emergency call is the highest-margin job in the beachhead.
      continued.push(
        await this.entries.create({
          id: this.ids.newId(),
          orgId,
          techUserId: cmd.techUserId,
          jobId: source.jobId,
          workDate: day.workDate,
          kind: source.kind,
          startTime: day.startTime,
          endTime: day.endTime,
          note: source.note,
          src: TAP_SRC,
          status: NEW_ENTRY_STATUS,
          running: false,
        }),
      );
    }
    return [closing.entry, ...continued];
  }

  private async startSegment(
    opening: OpeningRow,
    cmd: SetClockStateCommand,
    orgId: string,
  ): Promise<TimeEntry> {
    return this.entries.create({
      id: this.ids.newId(),
      orgId,
      techUserId: cmd.techUserId,
      jobId: opening.jobId,
      workDate: opening.workDate,
      kind: opening.kind,
      startTime: opening.startTime,
      // No end until the next tap. This is the one row a technician can be inside.
      endTime: null,
      note: NO_NOTE,
      src: TAP_SRC,
      status: NEW_ENTRY_STATUS,
      running: true,
    });
  }
}
