/**
 * features/field/job-time-derive.ts
 * Job attribution, derived — pure. What a shift's hours were SPENT ON, from the visit taps.
 *
 * IT DOES NOT SUM TO THE SHIFT, AND IT IS NOT SUPPOSED TO. This is the single fact most likely to be
 * "fixed" into a bug by someone reading the screen for the first time. Two reasons the totals differ,
 * both of them correct:
 *
 *   - DRIVE TIME between calls is paid and belongs to no job. So is a shop morning, a supply-house
 *     run, and a training hour.
 *   - a visit can be stamped OUTSIDE the shift the register shows. The clock and the visit taps are
 *     independent records made by the same man, and forcing one inside the other would silently
 *     rewrite whichever was inconvenient.
 *
 * So nothing here caps, clamps, distributes or balances. It reports the taps.
 *
 * MEASURED ONLY. A visit nobody stamped has no hours here — not zero hours. Zero is a measurement
 * ("he was there and it took no time"); absent is the truth ("nobody tapped"). The costing rollup
 * falls back to booked length because a cost report needs a figure for every visit; a man's own
 * timesheet must not, because a scheduled estimate in the same column as recorded time reads as his
 * own statement of what he did.
 */

import { timeLabelShort } from "@/lib/time";

const MINUTES_PER_HOUR = 60;
const MS_PER_HOUR = 3_600_000;

/**
 * An ISO instant → the wall clock the technician was looking at, on HIS device.
 *
 * The server sends instants on purpose: a stamp formatted in SQL comes out in the database's
 * timezone (UTC), so a man who arrived at eight in California read "3p" on his own timesheet. The
 * browser is the only participant that knows which clock he means.
 */
export function stampLabel(iso: string | null): string {
  if (iso === null) return "—";
  const at = new Date(iso);
  return timeLabelShort(at.getHours() + at.getMinutes() / MINUTES_PER_HOUR);
}

/**
 * An ISO instant → the "HH:MM" a `time_entries` row stores.
 *
 * The clock's columns hold LOCAL wall clock ("device-local as recorded"), so anything written from
 * an instant has to be converted on the device that will be believed. This is the write-path twin of
 * `stampLabel`, and it is the one that matters most: a wrong label is confusing, a wrong stored time
 * is a wrong paycheck.
 */
export function stampHHMM(iso: string): string {
  const at = new Date(iso);
  return `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
}

/** One visit's taps, exactly as `v1.timesheets.visitStamps` returns them. */
export interface VisitStamp {
  readonly visitId: string;
  readonly jobId: string;
  readonly jobNum: string;
  readonly jobTitle: string | null;
  readonly customerName: string | null;
  readonly workDate: string;
  /** Arrived, as an ISO instant. */
  readonly startedAt: string | null;
  /** Done, as an ISO instant. */
  readonly completedAt: string | null;
}

/** One row of the attribution table under a shift. */
export interface JobTimeRow {
  readonly key: string;
  readonly jobId: string;
  readonly jobNum: string;
  readonly jobTitle: string | null;
  readonly customerName: string | null;
  /** Already rendered in the technician's own timezone, e.g. "8:04a". */
  readonly startLabel: string;
  readonly endLabel: string;
  /** Kept for sorting: the raw instant, or null when nobody tapped. */
  readonly startedAt: string | null;
  /**
   * WHICH tap is missing, when the pair cannot be measured — null when it can.
   *
   * "Not stamped" is the wrong thing to say about a visit he tapped Done on: it was stamped, and the
   * office needs to know it is the ARRIVAL that is missing. Naming the missing tap is the difference
   * between a row he can act on and a row he can only shrug at.
   */
  readonly missing: "arrival" | "both" | null;
  /** Recorded hours, or null when this visit was never stamped — absent, never zero. */
  readonly hours: number | null;
  /** True while he is still on this job: arrived, not yet done. */
  readonly running: boolean;
}

/**
 * The measured length of one visit, or null.
 *
 * Null in three cases, and they are all "nobody measured this": no arrival tap, no done tap, or an
 * end before its start (which is a clock that was wrong, not a negative shift).
 */
export function stampHours(stamp: VisitStamp): number | null {
  if (stamp.startedAt === null || stamp.completedAt === null) return null;
  // Instant arithmetic, so a visit that spans midnight or a DST change measures correctly — a
  // wall-clock subtraction would report an hour that was never worked, or lose one that was.
  const hours = (new Date(stamp.completedAt).getTime() - new Date(stamp.startedAt).getTime()) / MS_PER_HOUR;
  return hours > 0 ? hours : null;
}

/** Which tap is absent, for a visit whose length cannot be measured. */
function missingTap(stamp: VisitStamp): "arrival" | "both" | null {
  if (stamp.startedAt !== null) return null;
  return stamp.completedAt === null ? "both" : "arrival";
}

export function toJobTimeRow(stamp: VisitStamp): JobTimeRow {
  return {
    key: stamp.visitId,
    jobId: stamp.jobId,
    jobNum: stamp.jobNum,
    jobTitle: stamp.jobTitle,
    customerName: stamp.customerName,
    startLabel: stampLabel(stamp.startedAt),
    endLabel: stampLabel(stamp.completedAt),
    startedAt: stamp.startedAt,
    hours: stampHours(stamp),
    missing: missingTap(stamp),
    running: stamp.startedAt !== null && stamp.completedAt === null,
  };
}

/**
 * One date's attribution rows, in the order the day happened.
 *
 * Unstamped visits sort LAST rather than being dropped: "you were sent here and never tapped" is
 * the row most worth seeing, and dropping it is how a missing tap becomes invisible.
 */
export function jobTimeForDate(
  stamps: readonly VisitStamp[],
  workDate: string,
): JobTimeRow[] {
  return stamps
    .filter((s) => s.workDate === workDate)
    .map(toJobTimeRow)
    .sort((a, b) => {
      if (a.startedAt === null) return b.startedAt === null ? 0 : 1;
      if (b.startedAt === null) return -1;
      return a.startedAt.localeCompare(b.startedAt);
    });
}

export interface JobTimeTotals {
  /** Hours attributed to jobs. NEVER compared against the shift — see the file header. */
  readonly attributed: number;
  /** Visits with no usable pair of taps. */
  readonly unmeasured: number;
}

export function jobTimeTotals(rows: readonly JobTimeRow[]): JobTimeTotals {
  return {
    attributed: rows.reduce((sum, r) => sum + (r.hours ?? 0), 0),
    unmeasured: rows.filter((r) => r.hours === null).length,
  };
}

/**
 * What to say about the gap between a shift and the jobs inside it — an EXPLANATION, never a
 * reconciliation.
 *
 * A man who sees 8.00 h on his shift and 6.25 h against jobs will ask where the difference went, and
 * the honest answer is a sentence, not an extra row. Only stated when the difference is worth a
 * sentence: a couple of minutes is rounding, and narrating it teaches him to stop reading.
 */
export const JOB_TIME_GAP_MINUTES = 15;

export function jobTimeGapNote(shiftHours: number, attributedHours: number): string | null {
  const gapHours = shiftHours - attributedHours;
  if (gapHours * 60 < JOB_TIME_GAP_MINUTES) return null;
  return `${gapHours.toFixed(2)} h of this shift is not on a job — driving, the shop, or time you have not attributed.`;
}
