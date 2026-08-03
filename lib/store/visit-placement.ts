/**
 * lib/store/visit-placement.ts
 * THE client-side rule for whether a visit has been placed on the board.
 *
 * This used to be eight identical copies — jobs-helpers, today-derive, schedule-panel, dto-mapper,
 * jobs-slice, jobs-hydrator, job-modal and the tech job modal each carried their own `isPlaced` /
 * `vPlaced` / `isPlacedVisit`. Eight copies of a rule is eight chances for one of them to drift,
 * and the drift is invisible until a job shows up in one surface and not the other.
 *
 * The SQL twin is `PLACED` in `modules/jobs/infra/job-views.ts`. The two must answer the same
 * question or work goes missing: the server decides which jobs are in "Needs a slot" and the
 * client decides which visits the board draws, so a visit both sides disagree about renders
 * nowhere and is listed nowhere.
 *
 * KNOWN DIFFERENCE, DELIBERATE: this predicate also requires a START time; the SQL rule requires
 * only a day and a crew. A dated, crewed visit with no start renders on the board (at the left
 * edge of its lane) but reads as unplaced here. There are zero such rows in the live database and
 * the front desk models "a date but no time yet" as a real booked state (see
 * modules/frontdesk/app/slots.ts), so closing that last clause is a product decision, not a bug
 * fix — it is written down here rather than resolved silently.
 */

/** The three placement facts, structurally — so callers holding a partial visit can ask too. */
export interface VisitPlacement {
  readonly date: string | null;
  readonly techId: string | null;
  readonly start: number | null;
}

/** A visit is PLACED once it has a day, a crew, and a start time (prototype vPlaced). */
export function isVisitPlaced(v: VisitPlacement): boolean {
  // `start` is compared to null, never checked for truthiness: midnight is hour 0.
  return Boolean(v.date) && v.techId != null && v.start != null;
}

/**
 * A visit that has landed on a day with nobody to run it — half planned.
 *
 * This is the shape the board cannot draw (no crew lane to sit in) and that the server now counts
 * as unplaced. Surfaces that show a "Needs a slot" job use it to say WHICH day is already spoken
 * for instead of pretending the job has no date at all.
 */
export function isVisitDatedUnassigned(v: VisitPlacement): boolean {
  return Boolean(v.date) && v.techId == null;
}
