import type { Job } from "../domain/job";

/**
 * The order a day is actually worked.
 *
 * My day used to sort on `jobs.scheduled_start`, which is a DEAD COLUMN — nothing in a live path
 * writes it (see infra/job-sorts.ts: zero non-null rows across the pilot org). So the comparator
 * collapsed to "equal" for every pair and the agenda came back in whatever order the keyset
 * happened to produce: random v4 UUIDs. A route in arbitrary order is not a route, and it only got
 * more visible once finished jobs started staying on the list.
 *
 * The real date lives on the VISITS, which is where scheduling has always written it. The key is
 * the earliest LIVE visit's date and start time.
 *
 * STRING COMPARISON, DELIBERATELY. `scheduled_date` is a calendar date and `scheduled_start` is a
 * wall-clock time — neither carries a zone, and both are meant as "what the crew reads on the
 * board". Parsing them into Date on the server would stamp them with the SERVER'S timezone
 * (UTC in production) and reorder a day around a zone nobody involved lives in. Zero-padded
 * `YYYY-MM-DDTHH:MM` sorts correctly as text, so the comparison stays in the same terms the
 * board uses.
 */

/** Zero-padded, lexicographically sortable. Null when the job has no dated visit worth keying on. */
export function earliestLiveVisitAt(job: Job): string | null {
  let earliestLive: string | null = null;
  let earliestDone: string | null = null;
  let unplacedLive = false;
  for (const visit of job.props.visits) {
    const v = visit.props;
    // Canceled visits are not work.
    if (v.status === "canceled") continue;
    // A live visit with no date is the return-trip shape (AddReturnTripUseCase lands it unplaced,
    // pending). It has no slot in the route — but it DOES mean the job's next work is unscheduled,
    // so a done visit's old slot must not answer for it below.
    if (v.scheduledDate === null) {
      if (v.status !== "complete") unplacedLive = true;
      continue;
    }
    const at = `${v.scheduledDate}T${v.scheduledStart ?? "00:00"}`;
    // LIVE (pending / in-progress) visits outrank COMPLETE ones outright: a half-done multi-visit
    // job keys on the visit the tech still has to drive to, not the one already worked — otherwise
    // a Monday visit marked complete pins the job to Monday while its return trip sits on today's
    // board. COMPLETE is the fallback, not discarded: Job.complete() closes open visits to
    // `complete`, so a fully finished job still keeps its slot in the route rather than jumping to
    // the end of the day.
    if (v.status === "complete") {
      if (earliestDone === null || at < earliestDone) earliestDone = at;
    } else if (earliestLive === null || at < earliestLive) {
      earliestLive = at;
    }
  }
  // No dated live visit: if live work exists but is unplaced, the job is honestly "not scheduled"
  // (sorts to the end like every undated job) — only a job with NOTHING left to drive to keeps its
  // finished slot.
  return earliestLive ?? (unplacedLive ? null : earliestDone);
}

/**
 * Earliest first; work with no date at all last.
 *
 * Unplaced work sorts to the END here, which is the opposite of the OFFICE list's default — and
 * right for the opposite reason. The office opens an ascending WHEN list to ask "what have I not
 * put on a day yet"; a technician opens My day to drive it. A job assigned to them with no date is
 * still shown (hiding it is how work goes missing), just not at the top of the route.
 *
 * Ties break on createdAt then id, so the same day always renders in the same order.
 */
export function byAgenda(a: Job, b: Job): number {
  const av = earliestLiveVisitAt(a);
  const bv = earliestLiveVisitAt(b);
  if (av !== bv) {
    if (av === null) return 1;
    if (bv === null) return -1;
    return av < bv ? -1 : 1;
  }
  const byCreated = a.props.createdAt.getTime() - b.props.createdAt.getTime();
  if (byCreated !== 0) return byCreated;
  return a.props.id < b.props.id ? -1 : a.props.id > b.props.id ? 1 : 0;
}
