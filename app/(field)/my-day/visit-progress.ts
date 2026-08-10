/**
 * app/(field)/my-day/visit-progress.ts
 * What an agenda row should say about a job whose visits have PARTLY happened — pure. No React,
 * no store, no clock.
 *
 * WHY IT EXISTS. The row described the JOB and nothing else: status pill, "Start job", "✓
 * Complete". On a two-stop job whose first stop was finished hours ago that read as though nobody
 * had been out — "SCHEDULED · Start job" — because the job genuinely IS still open (the return
 * trip is outstanding) and the job status is the only thing it asked. The row was not wrong; it
 * was answering a narrower question than the one a technician is asking when they look at it.
 *
 * The visits are already on the wire (jobSummaryDTO carries `visits`), so this needs nothing new
 * from the server — it just reads what the row was throwing away.
 */

/** The visit fields this reads. Structural, so both the DTO and a test fixture satisfy it. */
export interface ProgressVisit {
  readonly status: string;
  readonly scheduledDate: string | null;
}

export interface VisitProgress {
  /** Finished visits. */
  readonly done: number;
  /** Visits that still count — everything the shop has not canceled. */
  readonly total: number;
  /** Some finished, some not. The state the row had no words for. */
  readonly partly: boolean;
  /**
   * Every outstanding visit is waiting on a time. That is what a return trip booked from the
   * field looks like, and it is the one case where the row can name WHY the job is still open
   * rather than just that it is.
   */
  readonly awaitingSlot: boolean;
}

const DONE = "complete";
const CANCELED = "canceled";

/**
 * Read a job's visit set.
 *
 * Canceled visits are excluded from both counts: a stop the shop called off is not work anybody
 * still owes, and counting it would make "1 of 3 done" out of a job with one visit left to run.
 */
export function visitProgress(visits: readonly ProgressVisit[]): VisitProgress {
  const active = visits.filter((v) => v.status !== CANCELED);
  const done = active.filter((v) => v.status === DONE).length;
  const left = active.filter((v) => v.status !== DONE);
  return {
    done,
    total: active.length,
    partly: done > 0 && left.length > 0,
    // `every` on a non-empty list — `partly` above is what guarantees it is non-empty at the
    // one call site that asks. An all-done job answers false and never reaches the wording.
    awaitingSlot: left.length > 0 && left.every((v) => !v.scheduledDate),
  };
}

/**
 * The status pill's word, or null to keep the job-status pill the row already had.
 *
 * ONLY "RETURN TRIP", and only when it is literally true. A job with a finished first stop and a
 * DATED second one is not waiting on a return trip — it is mid-run, and the schedule already says
 * when. Naming that "return trip" would be the same class of small lie the row is being fixed for.
 */
export function progressPill(p: VisitProgress): string | null {
  return p.partly && p.awaitingSlot ? "Return trip" : null;
}

/**
 * The line under the job number, or null when there is nothing worth adding.
 *
 * Silent on a one-visit job: "1 of 1 visits done" is noise on the overwhelming majority of rows,
 * and the status pill already carries that fact.
 */
export function progressNote(p: VisitProgress): string | null {
  if (p.total < 2 || p.done === 0) return null;
  return `${p.done} of ${p.total} visits done`;
}

/**
 * May the row still offer "Start job"?
 *
 * No, once any visit has finished. Starting is a claim about the job not having begun, and the
 * technician who finished stop one can disprove it. "✓ Complete" stays — the job CAN be closed
 * from here, and that is the one thing this row should still be able to do.
 */
export function canOfferStart(p: VisitProgress): boolean {
  return p.done === 0;
}
