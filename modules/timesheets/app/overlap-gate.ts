import type { AppError, UserId } from "@mallet/shared/types";
import { validation, toPage } from "@mallet/shared/types";
import { toMinutes } from "../domain/time-entry";
import { findOverlap, overlapRefusal } from "../domain/overlap";
import type { TimeEntryRepository } from "../domain/time-entry-repository";

/**
 * The one overlap gate both manual write paths share — create and update phrase a collision
 * identically because they physically cannot diverge. The clock never comes through here
 * (SetClockStateUseCase writes via the repository), so a clock tap can never be refused.
 */

// One person's day holds a handful of rows; 200 is headroom, not a page walk.
const DAY_ROWS_LIMIT = 200;

export interface OverlapGateCandidate {
  /** The row being written. On update this is the entry's id; on create it is the
   *  client-authored id when one was sent — so a RETRIED create never clashes with its own
   *  already-landed row (the duplicate id is the database's unambiguous problem to name). */
  readonly id?: string;
  readonly techUserId: UserId;
  readonly workDate: string;
  readonly startTime: string;
  readonly endTime: string | null;
  readonly running: boolean;
}

/** The error refusing this write, or null when the day is clear. */
export async function overlapGateError(
  entries: TimeEntryRepository,
  cand: OverlapGateCandidate,
): Promise<AppError | null> {
  // Create feeds RAW command values here (domain validation happens later, inside the insert's
  // transaction) — an inverted window makes interval math meaningless, so it is refused up
  // front in the domain's own words rather than surfacing as a transaction rollback.
  const start = toMinutes(cand.startTime);
  const end = cand.endTime === null ? null : toMinutes(cand.endTime);
  if (start !== null && end !== null && end <= start) {
    return validation("endTime must be after startTime", "endTime");
  }

  const day = await entries.list(
    { techUserId: cand.techUserId, fromDate: cand.workDate, toDate: cand.workDate },
    toPage({ limit: DAY_ROWS_LIMIT, cursor: null }),
  );
  // A second page would be rows this gate never saw — trusting page 1 is exactly how an overlap
  // would slip into payroll unseen. This gate is the invariant's ONLY enforcement (there is
  // deliberately no DB exclusion constraint), so it refuses loudly instead.
  if (day.nextCursor !== null) {
    return validation("This day has too many rows to check for overlaps — remove some first.", "workDate");
  }

  // Time-off rows occupy no wall-clock window — a half-day of PTO beside an afternoon shift
  // is legal, so only punched rows can collide.
  const punched = day.items
    .map((e) => e.props)
    .filter((p): p is typeof p & { startTime: string } => p.startTime !== null);
  const clash = findOverlap(
    { id: cand.id, startTime: cand.startTime, endTime: cand.endTime, running: cand.running },
    punched,
  );
  return clash === null ? null : validation(overlapRefusal(clash), "startTime");
}
